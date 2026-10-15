import { and, desc, eq, gte, inArray, isNull, lt, not } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { ACTIVITY_SOURCES } from "$shared/types";
import { createDb, schema } from "../db";
import { dayRangeToIso, isYmd } from "../lib/dates";
import { toActivity, visibleActivity } from "../lib/queries";
import type { AppContext } from "../lib/session";
import { HttpError, httpUrl, idParam, parseBody } from "../lib/validate";
import { randomToken } from "../lib/crypto";

export const activityRoutes = new Hono<AppContext>();

/** GET /api/activities?from=YYYY-MM-DD&to=YYYY-MM-DD&source=a,b&goalId=1&unlinked=1&hidden=1|all&limit=200 (기본은 숨긴 활동과 미정·거절 일정 제외) */
activityRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const q = c.req.query();
  const conds = [];
  if (isYmd(q.from) && isYmd(q.to)) {
    const { from, to } = dayRangeToIso(q.from, q.to, c.env.TIMEZONE);
    conds.push(gte(schema.activities.occurredAt, from), lt(schema.activities.occurredAt, to));
  }
  if (q.source) conds.push(inArray(schema.activities.source, q.source.split(",") as (typeof ACTIVITY_SOURCES)[number][]));
  if (q.goalId) conds.push(eq(schema.activities.goalId, Number(q.goalId)));
  if (q.epicId) conds.push(eq(schema.activities.epicId, Number(q.epicId)));
  if (q.unlinked === "1") conds.push(isNull(schema.activities.goalId));
  if (q.hidden === "1") conds.push(not(visibleActivity));
  else if (q.hidden !== "all") conds.push(visibleActivity);
  const limit = Math.min(Number(q.limit) || 200, 1000);
  const rows = await db.query.activities.findMany({
    where: conds.length ? and(...conds) : undefined,
    orderBy: [desc(schema.activities.occurredAt)],
    limit,
  });
  return c.json(rows.map(toActivity));
});

/** 수동 활동 추가 */
activityRoutes.post("/", async (c) => {
  const body = await parseBody(
    c,
    z.object({
      title: z.string().trim().min(1).max(500),
      url: httpUrl.nullable().optional(),
      occurredAt: z.string().datetime({ offset: true }).optional(),
      goalId: z.number().int().positive().nullable().optional(),
      epicId: z.number().int().positive().nullable().optional(),
      taskId: z.number().int().positive().nullable().optional(),
      isHighlight: z.boolean().optional(),
      note: z.string().max(4000).nullable().optional(),
    }),
  );
  const db = createDb(c.env.DB);
  const [row] = await db
    .insert(schema.activities)
    .values({
      source: "manual",
      externalId: randomToken(12),
      title: body.title,
      url: body.url ?? null,
      occurredAt: body.occurredAt ? new Date(body.occurredAt).toISOString() : new Date().toISOString(),
      goalId: body.goalId ?? null,
      epicId: body.epicId ?? null,
      taskId: body.taskId ?? null,
      isHighlight: body.isHighlight ?? false,
      note: body.note ?? null,
    })
    .returning();
  return c.json(toActivity(row), 201);
});

/** 연결·하이라이트·숨김·메모 수정 */
activityRoutes.patch("/:id", async (c) => {
  const id = idParam(c);
  const body = await parseBody(
    c,
    z.object({
      goalId: z.number().int().positive().nullable().optional(),
      epicId: z.number().int().positive().nullable().optional(),
      taskId: z.number().int().positive().nullable().optional(),
      isHighlight: z.boolean().optional(),
      isHidden: z.boolean().optional(),
      note: z.string().max(4000).nullable().optional(),
      title: z.string().trim().min(1).max(500).optional(),
    }),
  );
  const db = createDb(c.env.DB);
  const existing = await db.query.activities.findFirst({ where: eq(schema.activities.id, id), columns: { taskId: true } });
  if (!existing) throw new HttpError(404, "activity not found");
  // Task 에서 나온 활동의 목표는 Task 를 따르므로 활동 쪽에서는 바꾸지 않는다.
  if (existing.taskId !== null && (body.goalId !== undefined || body.taskId !== undefined)) {
    throw new HttpError(409, "Task 에 연결된 활동입니다. 목표는 Board 의 Task 에서 바꾸세요.");
  }
  const [row] = await db.update(schema.activities).set(body).where(eq(schema.activities.id, id)).returning();
  if (!row) throw new HttpError(404, "activity not found");
  return c.json(toActivity(row));
});

activityRoutes.delete("/:id", async (c) => {
  const id = idParam(c);
  const db = createDb(c.env.DB);
  const existing = await db.query.activities.findFirst({ where: eq(schema.activities.id, id) });
  if (!existing) throw new HttpError(404, "activity not found");
  if (existing.source !== "manual") throw new HttpError(409, "only manual activities can be deleted");
  await db.delete(schema.activities).where(eq(schema.activities.id, id));
  return c.json({ ok: true });
});
