import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { GOAL_STATUSES } from "$shared/types";
import { createDb, schema } from "../db";
import type { AppContext } from "../lib/session";
import { HttpError, idParam, parseBody } from "../lib/validate";

const createSchema = z.object({
  sprintId: z.number().int().positive(),
  epicId: z.number().int().positive().nullable().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(4000).nullable().optional(),
  successCriteria: z.string().max(2000).nullable().optional(),
  status: z.enum(GOAL_STATUSES).optional(),
  order: z.number().int().optional(),
});

const updateSchema = createSchema.partial().extend({
  progressNote: z.string().max(4000).nullable().optional(),
});

export const goalRoutes = new Hono<AppContext>();

goalRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const sprintId = c.req.query("sprintId");
  const epicId = c.req.query("epicId");
  const rows = await db.query.goals.findMany({
    where: sprintId
      ? eq(schema.goals.sprintId, Number(sprintId))
      : epicId
        ? eq(schema.goals.epicId, Number(epicId))
        : undefined,
    orderBy: [asc(schema.goals.sprintId), asc(schema.goals.order), asc(schema.goals.id)],
  });
  return c.json(rows);
});

goalRoutes.post("/", async (c) => {
  const body = await parseBody(c, createSchema);
  const db = createDb(c.env.DB);
  const sprint = await db.query.sprints.findFirst({ where: eq(schema.sprints.id, body.sprintId) });
  if (!sprint) throw new HttpError(404, "sprint not found");
  const [row] = await db.insert(schema.goals).values(body).returning();
  return c.json(row, 201);
});

goalRoutes.patch("/:id", async (c) => {
  const id = idParam(c);
  const body = await parseBody(c, updateSchema);
  const db = createDb(c.env.DB);
  const [row] = await db
    .update(schema.goals)
    .set({ ...body, updatedAt: new Date().toISOString() })
    .where(eq(schema.goals.id, id))
    .returning();
  if (!row) throw new HttpError(404, "goal not found");
  return c.json(row);
});

goalRoutes.delete("/:id", async (c) => {
  const id = idParam(c);
  const db = createDb(c.env.DB);
  const res = await db.delete(schema.goals).where(eq(schema.goals.id, id)).returning({ id: schema.goals.id });
  if (res.length === 0) throw new HttpError(404, "goal not found");
  return c.json({ ok: true });
});
