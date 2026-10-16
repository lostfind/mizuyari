import { asc, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { createDb, schema } from "../db";
import { addDays, isYmd, todayInTz } from "../lib/dates";
import { getCurrentSprint, getSprintDetail } from "../lib/queries";
import type { AppContext } from "../lib/session";
import { HttpError, idParam, parseBody } from "../lib/validate";

const ymd = z.string().refine(isYmd, "YYYY-MM-DD");

const createSchema = z.object({
  startDate: ymd,
  endDate: ymd.optional(),
  meetingDate: ymd.nullable().optional(),
});

const updateSchema = z.object({
  startDate: ymd.optional(),
  endDate: ymd.optional(),
  meetingDate: ymd.nullable().optional(),
  status: z.enum(["active", "closed"]).optional(),
});

export const sprintRoutes = new Hono<AppContext>();

sprintRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const rows = await db.query.sprints.findMany({ orderBy: [desc(schema.sprints.startDate)] });
  return c.json(rows);
});

sprintRoutes.get("/current", async (c) => {
  const db = createDb(c.env.DB);
  const today = todayInTz(c.env.TIMEZONE);
  const sprint = await getCurrentSprint(db, today);
  if (!sprint) return c.json(null);
  return c.json(await getSprintDetail(db, sprint.id, c.env.TIMEZONE));
});

sprintRoutes.post("/", async (c) => {
  const body = await parseBody(c, createSchema);
  const db = createDb(c.env.DB);
  const endDate = body.endDate ?? addDays(body.startDate, 13);
  if (endDate < body.startDate) throw new HttpError(400, "endDate must be after startDate");
  const [row] = await db
    .insert(schema.sprints)
    .values({ startDate: body.startDate, endDate, meetingDate: body.meetingDate ?? addDays(endDate, 1) })
    .returning();
  return c.json(row, 201);
});

sprintRoutes.get("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const detail = await getSprintDetail(db, idParam(c), c.env.TIMEZONE);
  if (!detail) throw new HttpError(404, "sprint not found");
  return c.json(detail);
});

sprintRoutes.patch("/:id", async (c) => {
  const id = idParam(c);
  const body = await parseBody(c, updateSchema);
  const db = createDb(c.env.DB);
  const current = await db.query.sprints.findFirst({ where: eq(schema.sprints.id, id) });
  if (!current) throw new HttpError(404, "sprint not found");
  // 한쪽만 바꿔도 합친 기간이 올바른지 확인
  if ((body.endDate ?? current.endDate) < (body.startDate ?? current.startDate)) {
    throw new HttpError(400, "endDate must not be before startDate");
  }
  const [row] = await db.update(schema.sprints).set(body).where(eq(schema.sprints.id, id)).returning();
  return c.json(row);
});

/** 스프린트 종료: status=closed, 미완료 Goal 은 그대로 둔다 (다음 스프린트에서 같은 Epic 아래 새 Goal 로 이어간다). */
sprintRoutes.post("/:id/close", async (c) => {
  const id = idParam(c);
  const db = createDb(c.env.DB);
  const [row] = await db.update(schema.sprints).set({ status: "closed" }).where(eq(schema.sprints.id, id)).returning();
  if (!row) throw new HttpError(404, "sprint not found");
  return c.json(row);
});

/** 다음 스프린트 생성 + 선택한 Goal 을 같은 Epic 아래 새 Goal 로 복제 */
sprintRoutes.post("/:id/next", async (c) => {
  const id = idParam(c);
  const body = await parseBody(
    c,
    z.object({
      startDate: ymd.optional(),
      carryGoalIds: z.array(z.number().int().positive()).default([]),
      closeCurrent: z.boolean().default(true),
    }),
  );
  const db = createDb(c.env.DB);
  const current = await db.query.sprints.findFirst({ where: eq(schema.sprints.id, id) });
  if (!current) throw new HttpError(404, "sprint not found");

  const startDate = body.startDate ?? addDays(current.endDate, 1);
  const endDate = addDays(startDate, 13);
  const [next] = await db
    .insert(schema.sprints)
    .values({ startDate, endDate, meetingDate: addDays(endDate, 1) })
    .returning();

  if (body.carryGoalIds.length) {
    const goals = await db.query.goals.findMany({
      where: eq(schema.goals.sprintId, id),
      orderBy: [asc(schema.goals.order)],
    });
    const carry = goals.filter((g) => body.carryGoalIds.includes(g.id));
    for (const [i, g] of carry.entries()) {
      await db.insert(schema.goals).values({
        sprintId: next.id,
        epicId: g.epicId,
        title: g.title,
        description: g.description,
        successCriteria: g.successCriteria,
        status: "not_started",
        order: i,
      });
    }
  }
  if (body.closeCurrent) {
    await db.update(schema.sprints).set({ status: "closed" }).where(eq(schema.sprints.id, id));
  }
  return c.json(next, 201);
});
