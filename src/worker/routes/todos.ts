// Google Tasks 의 미완료 TODO. 조회와 완료 처리만 제공한다 (삭제·수정은 하지 않는다).

import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { getGoogleAccessToken } from "../auth/google";
import { completeGoogleTodo } from "../collectors/google";
import { refreshOpenTodos, upsertActivities } from "../collectors/run";
import { createDb, schema } from "../db";
import type { AppContext } from "../lib/session";
import { HttpError, idParam } from "../lib/validate";

export const todoRoutes = new Hono<AppContext>();

todoRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const rows = await db.query.googleTodos.findMany({
    orderBy: [asc(schema.googleTodos.due), asc(schema.googleTodos.listTitle), asc(schema.googleTodos.position)],
  });
  return c.json(rows);
});

/** Google 에서 미완료 TODO 를 다시 가져온다 (전체 동기화보다 가볍다). */
todoRoutes.post("/refresh", async (c) => {
  const db = createDb(c.env.DB);
  const token = await getGoogleAccessToken(db, c.env);
  const count = await refreshOpenTodos(db, token);
  return c.json({ count });
});

/** 완료 처리: Google 에 PATCH → 완료 활동 기록 → 스냅샷에서 제거 */
todoRoutes.post("/:id/complete", async (c) => {
  const id = idParam(c);
  const db = createDb(c.env.DB);
  const todo = await db.query.googleTodos.findFirst({ where: eq(schema.googleTodos.id, id) });
  if (!todo) throw new HttpError(404, "todo not found");

  const token = await getGoogleAccessToken(db, c.env);
  const completedAt = await completeGoogleTodo(token, todo.listId, todo.taskId);

  await upsertActivities(db, [
    {
      source: "google_task",
      externalId: `${todo.listId}:${todo.taskId}`,
      title: `TODO 완료 · ${todo.title}`,
      url: todo.webViewLink,
      occurredAt: completedAt,
      metadata: { list: todo.listTitle, due: todo.due, notes: todo.notes, via: "mizuyari" },
    },
  ]);
  await db.delete(schema.googleTodos).where(eq(schema.googleTodos.id, id));
  return c.json({ ok: true, completedAt });
});
