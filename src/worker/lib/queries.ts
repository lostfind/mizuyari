// 여러 라우트가 함께 쓰는 조회 로직.

import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, or } from "drizzle-orm";
import type { Activity, Goal, GoalStatus, GoalWithActivities, Sprint, SprintDetail } from "$shared/types";
import type { Db } from "../db";
import { schema } from "../db";
import { dayRangeToIso } from "./dates";

export function toActivity(row: typeof schema.activities.$inferSelect): Activity {
  return { ...row, metadata: row.metadata ?? null };
}

export async function getCurrentSprint(db: Db, today: string): Promise<Sprint | null> {
  // 오늘을 포함하는 active 스프린트 → 없으면 가장 최근 active
  const containing = await db.query.sprints.findFirst({
    where: and(eq(schema.sprints.status, "active"), lte(schema.sprints.startDate, today), gte(schema.sprints.endDate, today)),
    orderBy: [desc(schema.sprints.startDate)],
  });
  if (containing) return containing;
  return (
    (await db.query.sprints.findFirst({
      where: eq(schema.sprints.status, "active"),
      orderBy: [desc(schema.sprints.startDate)],
    })) ?? null
  );
}

/** 스프린트 상세: 목표 + 각 목표의 활동, 미연결 활동(기간 내), 스프린트의 Task */
export async function getSprintDetail(db: Db, sprintId: number, tz: string): Promise<SprintDetail | null> {
  const sprint = await db.query.sprints.findFirst({ where: eq(schema.sprints.id, sprintId) });
  if (!sprint) return null;

  const goalRows = await db.query.goals.findMany({
    where: eq(schema.goals.sprintId, sprintId),
    orderBy: [asc(schema.goals.order), asc(schema.goals.id)],
  });
  const epicIds = [...new Set(goalRows.map((g) => g.epicId).filter((x): x is number => x !== null))];
  const epicRows = epicIds.length
    ? await db.query.epics.findMany({ where: inArray(schema.epics.id, epicIds), columns: { id: true, title: true } })
    : [];
  const epicById = new Map(epicRows.map((e) => [e.id, e]));

  const { from, to } = dayRangeToIso(sprint.startDate, sprint.endDate, tz);
  const goalIds = goalRows.map((g) => g.id);

  // 목표에 연결된 활동은 기간과 무관하게 전부, 미연결 활동은 스프린트 기간 내만
  const linked = goalIds.length
    ? await db.query.activities.findMany({ where: inArray(schema.activities.goalId, goalIds), orderBy: [desc(schema.activities.occurredAt)] })
    : [];
  const unlinked = await db.query.activities.findMany({
    where: and(isNull(schema.activities.goalId), gte(schema.activities.occurredAt, from), lt(schema.activities.occurredAt, to)),
    orderBy: [desc(schema.activities.occurredAt)],
  });

  const goals: GoalWithActivities[] = goalRows.map((g) => ({
    ...g,
    epic: g.epicId ? (epicById.get(g.epicId) ?? null) : null,
    activities: linked.filter((a) => a.goalId === g.id).map(toActivity),
  }));

  // 스프린트의 Task 에 더해, 활동이 가리키는 Task 도 포함한다 (화면에서 「Task: 제목」 표시용).
  const referencedTaskIds = [...new Set([...linked, ...unlinked].map((a) => a.taskId).filter((x): x is number => x !== null))];
  const tasks = await db.query.tasks.findMany({
    where: referencedTaskIds.length
      ? or(eq(schema.tasks.sprintId, sprintId), inArray(schema.tasks.id, referencedTaskIds))
      : eq(schema.tasks.sprintId, sprintId),
    orderBy: [asc(schema.tasks.order), asc(schema.tasks.id)],
  });

  return { sprint, goals, unlinkedActivities: unlinked.map(toActivity), tasks };
}

export function emptyGoalCounts(): Record<GoalStatus, number> {
  return { not_started: 0, in_progress: 0, achieved: 0, partial: 0, dropped: 0 };
}

/** 분기·반기 집계. Sprint/Goal 은 end_date 기준, Activity 는 occurred_at 기준으로 기간에 속한다. */
export async function getPeriodData(db: Db, periodStart: string, periodEnd: string, tz: string) {
  const sprints = await db.query.sprints.findMany({
    where: and(gte(schema.sprints.endDate, periodStart), lte(schema.sprints.endDate, periodEnd)),
    orderBy: [asc(schema.sprints.startDate)],
  });
  const sprintIds = sprints.map((s) => s.id);
  const goals: Goal[] = sprintIds.length
    ? await db.query.goals.findMany({ where: inArray(schema.goals.sprintId, sprintIds), orderBy: [asc(schema.goals.sprintId), asc(schema.goals.order)] })
    : [];

  const { from, to } = dayRangeToIso(periodStart, periodEnd, tz);
  const activityRows = await db.query.activities.findMany({
    where: and(gte(schema.activities.occurredAt, from), lt(schema.activities.occurredAt, to)),
    orderBy: [asc(schema.activities.occurredAt)],
  });
  const activities = activityRows.map(toActivity);

  const goalCounts = emptyGoalCounts();
  for (const g of goals) goalCounts[g.status]++;

  // Epic: 기간 내 Goal 이 붙었거나 활동이 직접 붙은 Epic
  const goalById = new Map(goals.map((g) => [g.id, g]));
  const epicIdSet = new Set<number>();
  for (const g of goals) if (g.epicId) epicIdSet.add(g.epicId);
  for (const a of activities) {
    if (a.epicId) epicIdSet.add(a.epicId);
    else if (a.goalId && goalById.get(a.goalId)?.epicId) epicIdSet.add(goalById.get(a.goalId)!.epicId!);
  }
  const epicRows = epicIdSet.size
    ? await db.query.epics.findMany({ where: inArray(schema.epics.id, [...epicIdSet]), orderBy: [asc(schema.epics.order), asc(schema.epics.id)] })
    : [];
  const epics = epicRows.map((epic) => {
    const epicGoals = goals.filter((g) => g.epicId === epic.id);
    const goalIds = new Set(epicGoals.map((g) => g.id));
    return {
      epic,
      goals: epicGoals,
      activities: activities.filter((a) => a.epicId === epic.id || (a.goalId !== null && goalIds.has(a.goalId))),
    };
  });

  const highlights = activities.filter((a) => a.isHighlight && !a.goalId);

  const reports = await db.query.reports.findMany({
    where: and(gte(schema.reports.periodEnd, periodStart), lte(schema.reports.periodEnd, periodEnd)),
    orderBy: [asc(schema.reports.periodStart)],
  });

  return { sprints, goals, activities, goalCounts, epics, highlights, reports };
}
