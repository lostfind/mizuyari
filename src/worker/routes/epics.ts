import { asc, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { EPIC_STATUSES } from "$shared/types";
import { createDb, schema } from "../db";
import type { AppContext } from "../lib/session";
import { HttpError, idParam, parseBody } from "../lib/validate";

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(4000).nullable().optional(),
  status: z.enum(EPIC_STATUSES).optional(),
  progressNote: z.string().max(4000).nullable().optional(),
  order: z.number().int().optional(),
});

export const epicRoutes = new Hono<AppContext>();

epicRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const status = c.req.query("status");
  const rows = await db.query.epics.findMany({
    where: status ? eq(schema.epics.status, status as (typeof EPIC_STATUSES)[number]) : undefined,
    orderBy: [asc(schema.epics.order), asc(schema.epics.id)],
  });
  return c.json(rows);
});

/** Epic 상세: 속한 Goal 들(스프린트 정보 포함) */
epicRoutes.get("/:id", async (c) => {
  const id = idParam(c);
  const db = createDb(c.env.DB);
  const epic = await db.query.epics.findFirst({ where: eq(schema.epics.id, id) });
  if (!epic) throw new HttpError(404, "epic not found");
  const goals = await db
    .select({
      goal: schema.goals,
      sprint: schema.sprints,
    })
    .from(schema.goals)
    .innerJoin(schema.sprints, eq(schema.goals.sprintId, schema.sprints.id))
    .where(eq(schema.goals.epicId, id))
    .orderBy(desc(schema.sprints.startDate), asc(schema.goals.order));
  const activities = await db.query.activities.findMany({
    where: eq(schema.activities.epicId, id),
    orderBy: [desc(schema.activities.occurredAt)],
  });
  return c.json({ epic, goals, activities });
});

epicRoutes.post("/", async (c) => {
  const body = await parseBody(c, createSchema);
  const db = createDb(c.env.DB);
  const [row] = await db.insert(schema.epics).values(body).returning();
  return c.json(row, 201);
});

epicRoutes.patch("/:id", async (c) => {
  const id = idParam(c);
  const body = await parseBody(c, createSchema.partial());
  const db = createDb(c.env.DB);
  const [row] = await db
    .update(schema.epics)
    .set({ ...body, updatedAt: new Date().toISOString() })
    .where(eq(schema.epics.id, id))
    .returning();
  if (!row) throw new HttpError(404, "epic not found");
  return c.json(row);
});

epicRoutes.delete("/:id", async (c) => {
  const id = idParam(c);
  const db = createDb(c.env.DB);
  const res = await db.delete(schema.epics).where(eq(schema.epics.id, id)).returning({ id: schema.epics.id });
  if (res.length === 0) throw new HttpError(404, "epic not found");
  return c.json({ ok: true });
});
