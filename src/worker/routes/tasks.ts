import { and, asc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { TASK_PRIORITIES, TASK_STATUSES, type TaskStatus } from "$shared/types";
import { importGithubWork, upsertActivities } from "../collectors/run";
import { createDb, schema, type Db } from "../db";
import { isYmd, todayInTz } from "../lib/dates";
import { getCurrentSprint } from "../lib/queries";
import type { AppContext } from "../lib/session";
import { linkActivitiesToTasks, propagateTaskGoal } from "../lib/taskLink";
import { HttpError, httpUrl, idParam, parseBody } from "../lib/validate";

const createSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(4000).nullable().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueDate: z.string().refine(isYmd, "YYYY-MM-DD").nullable().optional(),
  sprintId: z.number().int().positive().nullable().optional(),
  goalId: z.number().int().positive().nullable().optional(),
  githubUrl: httpUrl.nullable().optional(),
  order: z.number().int().optional(),
});

export const taskRoutes = new Hono<AppContext>();

taskRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const status = c.req.query("status");
  const sprintId = c.req.query("sprintId");
  const conds = [];
  if (status) conds.push(inArray(schema.tasks.status, status.split(",") as (typeof TASK_STATUSES)[number][]));
  if (sprintId) conds.push(eq(schema.tasks.sprintId, Number(sprintId)));
  const rows = await db.query.tasks.findMany({
    where: conds.length ? and(...conds) : undefined,
    orderBy: [asc(schema.tasks.status), asc(schema.tasks.order), asc(schema.tasks.id)],
  });
  return c.json(rows);
});

/**
 * Backlog 는 스프린트와 무관하게 쌓아 두는 곳이고, Todo 부터가 스프린트 대상이다.
 * - Backlog 로 가면 스프린트를 비운다.
 * - Backlog 에서 Todo/In Progress/Done 으로 나오거나 스프린트 없이 그 칸에 있으면 현재 스프린트를 붙인다.
 * 요청이 sprintId 를 직접 주면 그 값을 따른다 (Backlog 는 예외 없이 비운다).
 */
async function sprintForStatus(
  db: Db,
  tz: string,
  status: TaskStatus,
  from: { status: TaskStatus; sprintId: number | null } | null,
  requested: number | null | undefined,
): Promise<number | null | undefined> {
  if (status === "backlog") return null;
  if (requested !== undefined && requested !== null) return requested;
  if (from && from.status !== "backlog" && from.sprintId !== null) return undefined;
  return (await getCurrentSprint(db, todayInTz(tz)))?.id ?? null;
}

taskRoutes.post("/", async (c) => {
  const body = await parseBody(c, createSchema);
  const db = createDb(c.env.DB);
  const sprintId = await sprintForStatus(db, c.env.TIMEZONE, body.status ?? "todo", null, body.sprintId);
  const [row] = await db.insert(schema.tasks).values({ ...body, sprintId }).returning();
  if (row.githubUrl) await linkActivitiesToTasks(db, row.id);
  return c.json(row, 201);
});

taskRoutes.patch("/:id", async (c) => {
  const id = idParam(c);
  const body = await parseBody(c, createSchema.partial());
  const db = createDb(c.env.DB);
  const before = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, id) });
  if (!before) throw new HttpError(404, "task not found");
  const now = new Date().toISOString();
  // 상태가 바뀔 때만 스프린트를 맞춘다. 편집 화면에서 스프린트만 바꾸는 경우는 그대로 둔다.
  const patch = { ...body };
  if (body.status && body.status !== before.status) {
    const sprintId = await sprintForStatus(db, c.env.TIMEZONE, body.status, before, body.sprintId);
    if (sprintId !== undefined) patch.sprintId = sprintId;
  }
  const [row] = await db
    .update(schema.tasks)
    .set({ ...patch, updatedAt: now })
    .where(eq(schema.tasks.id, id))
    .returning();

  // GitHub 연결이 바뀌면 같은 url 의 수집 활동을 다시 잇고, 목표가 바뀌면 연결된 활동이 따라가게 한다.
  if (body.githubUrl !== undefined && body.githubUrl !== before.githubUrl) {
    await linkActivitiesToTasks(db, id);
  } else if (body.goalId !== undefined && body.goalId !== before.goalId) {
    await propagateTaskGoal(db, id, row.goalId);
  }

  // GitHub 연결이 없는 Task 가 done 으로 바뀌면 활동으로 기록해 리포트에 잡히게 한다.
  // GitHub 연결 Task 는 수집된 Issue closed / PR merged 활동이 완료 기록을 대신한다.
  if (body.status === "done" && before.status !== "done" && !row.githubUrl) {
    await upsertActivities(db, [
      {
        source: "task_status",
        externalId: `${id}:done`,
        title: row.title,
        url: null,
        occurredAt: now,
        metadata: { taskId: id, via: "board" },
      },
    ]);
    await db
      .update(schema.activities)
      .set({ taskId: id, goalId: row.goalId })
      .where(and(eq(schema.activities.source, "task_status"), eq(schema.activities.externalId, `${id}:done`)));
  }
  return c.json(row);
});

taskRoutes.delete("/:id", async (c) => {
  const id = idParam(c);
  const db = createDb(c.env.DB);
  const res = await db.delete(schema.tasks).where(eq(schema.tasks.id, id)).returning({ id: schema.tasks.id });
  if (res.length === 0) throw new HttpError(404, "task not found");
  return c.json({ ok: true });
});

/** GitHub 의 진행 대상을 Task 로 가져온다 (이미 있는 URL 은 건너뜀). 규칙은 importGithubWork 참고. */
taskRoutes.post("/import-github", async (c) => {
  if (!c.env.GITHUB_TOKEN) throw new HttpError(400, "GITHUB_TOKEN not set");
  const db = createDb(c.env.DB);
  return c.json(await importGithubWork(db, c.env.GITHUB_TOKEN, c.env.TIMEZONE));
});
