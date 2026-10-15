// Google Tasks 의 미완료 TODO. 조회와 완료 / 완료 취소만 제공한다 (생성·삭제·내용 수정은 하지 않는다).

import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { getGoogleAccessToken } from "../auth/google";
import { fetchGoogleTaskListTitle, setGoogleTodoCompleted } from "../collectors/google";
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
  const open = await refreshOpenTodos(db, token);
  return c.json({ count: open.size });
});

/** 완료 처리: Google 에 PATCH → 완료 활동 기록 → 스냅샷에서 제거 */
todoRoutes.post("/:id/complete", async (c) => {
  const id = idParam(c);
  const db = createDb(c.env.DB);
  const todo = await db.query.googleTodos.findFirst({ where: eq(schema.googleTodos.id, id) });
  if (!todo) throw new HttpError(404, "todo not found");

  const token = await getGoogleAccessToken(db, c.env);
  const t = await setGoogleTodoCompleted(token, todo.listId, todo.taskId, true);
  const completedAt = t.completed ?? new Date().toISOString();

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

/**
 * 완료 취소: 완료 활동(google_task) id 를 받아 Google 에 needsAction 으로 PATCH → 스냅샷에 되돌림 → 완료 활동 삭제.
 * 활동에 붙인 목표 연결·메모는 함께 사라진다 (완료 자체를 되돌리는 것이므로).
 */
todoRoutes.post("/reopen/:id", async (c) => {
  const id = idParam(c);
  const db = createDb(c.env.DB);
  const activity = await db.query.activities.findFirst({
    where: and(eq(schema.activities.id, id), eq(schema.activities.source, "google_task")),
  });
  if (!activity) throw new HttpError(404, "completed todo not found");

  const sep = activity.externalId.indexOf(":");
  if (sep <= 0) throw new HttpError(400, "invalid todo id");
  const listId = activity.externalId.slice(0, sep);
  const taskId = activity.externalId.slice(sep + 1);

  const token = await getGoogleAccessToken(db, c.env);
  const t = await setGoogleTodoCompleted(token, listId, taskId, false);
  const meta = (activity.metadata ?? {}) as { list?: string | null };
  const listTitle = meta.list ?? (await fetchGoogleTaskListTitle(token, listId)) ?? "";

  const now = new Date().toISOString();
  await db
    .insert(schema.googleTodos)
    .values({
      listId,
      listTitle,
      taskId,
      title: t.title?.trim() || activity.title.replace(/^TODO 완료 · /, ""),
      notes: t.notes ?? null,
      due: t.due ?? null,
      webViewLink: t.webViewLink ?? activity.url,
      position: t.position ?? "",
      updated: t.updated ?? now,
      syncedAt: now,
    })
    .onConflictDoNothing();
  await db.delete(schema.activities).where(eq(schema.activities.id, id));
  return c.json({ ok: true });
});
