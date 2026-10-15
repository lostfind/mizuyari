// Today 화면용 묶음 응답: 현재 스프린트 요약, 진행 중 Task, 오늘 일정(수집된 calendar_event), 최근 완료 TODO

import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { Hono } from "hono";
import { createDb, schema } from "../db";
import { addDays, dayRangeToIso, todayInTz } from "../lib/dates";
import { SETTING_KEYS } from "../collectors/run";
import { getCurrentSprint, toActivity } from "../lib/queries";
import type { AppContext } from "../lib/session";

export const todayRoutes = new Hono<AppContext>();

todayRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const tz = c.env.TIMEZONE;
  const today = todayInTz(tz);
  const sprint = await getCurrentSprint(db, today);

  let goalSummary = null;
  if (sprint) {
    const goals = await db.query.goals.findMany({ where: eq(schema.goals.sprintId, sprint.id) });
    goalSummary = {
      total: goals.length,
      achieved: goals.filter((g) => g.status === "achieved").length,
      inProgress: goals.filter((g) => g.status === "in_progress").length,
    };
  }

  const tasks = await db.query.tasks.findMany({
    where: inArray(schema.tasks.status, ["in_progress", "todo"]),
    orderBy: [asc(schema.tasks.status), asc(schema.tasks.order), asc(schema.tasks.dueDate)],
    limit: 20,
  });

  const { from, to } = dayRangeToIso(today, today, tz);
  const events = await db.query.activities.findMany({
    where: and(eq(schema.activities.source, "calendar_event"), gte(schema.activities.occurredAt, from), lt(schema.activities.occurredAt, to)),
    orderBy: [asc(schema.activities.occurredAt)],
  });

  // 거절한 일정은 수집 단계에서 지우지만, 메모 등이 붙어 남겨 둔 행은 여기서 숨긴다.
  const visibleEvents = events.map(toActivity).filter((e) => e.metadata?.response !== "declined");
  const labelRow = await db.query.settings.findFirst({ where: eq(schema.settings.key, SETTING_KEYS.calendarColorLabels) });
  let calendarLabels: Record<string, string> = {};
  try {
    calendarLabels = labelRow ? JSON.parse(labelRow.value) : {};
  } catch {
    // 잘못 저장된 값은 무시한다
  }

  const openTodos = await db.query.googleTodos.findMany({
    orderBy: [asc(schema.googleTodos.due), asc(schema.googleTodos.listTitle), asc(schema.googleTodos.position)],
    limit: 50,
  });

  const weekAgo = addDays(today, -7);
  const recentTodos = await db.query.activities.findMany({
    where: and(eq(schema.activities.source, "google_task"), gte(schema.activities.occurredAt, dayRangeToIso(weekAgo, today, tz).from)),
    orderBy: [desc(schema.activities.occurredAt)],
    limit: 10,
  });

  return c.json({
    today,
    sprint,
    goalSummary,
    tasks,
    events: visibleEvents,
    calendarLabels,
    openTodos,
    recentTodos: recentTodos.map(toActivity),
  });
});
