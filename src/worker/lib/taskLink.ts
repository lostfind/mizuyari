// Task 와 수집 활동의 연결.
//
// Task 의 github_url 과 같은 url 을 가진 활동(github_issue / github_pr / github_review)은 그 Task 에서 나온 것으로 보고
// task_id 를 채운다. 연결된 활동의 goal_id 는 Task 의 goal_id 를 그대로 따르는 파생값이라 사용자가 활동 쪽에서
// 따로 지정하지 않는다. task_id 가 없는 활동만 활동 단위로 목표를 붙인다.

import { and, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import type { Db } from "../db";
import { schema } from "../db";

/** URL 로 연결되는 활동 source. task_status 는 Task 가 직접 만든 활동이라 별도로 다룬다. */
const URL_LINKED_SOURCES = ["github_issue", "github_pr", "github_review"] as const;

/**
 * github_url 이 있는 모든 Task 에 대해 같은 url 의 활동을 연결하고 goal_id 를 맞춘다. 멱등이라 동기화 뒤마다 돌려도 된다.
 * 하나의 Task 만 손봤을 때는 taskId 를 넘겨 그 Task 만 처리한다.
 */
export async function linkActivitiesToTasks(db: Db, taskId?: number): Promise<number> {
  const tasks = await db.query.tasks.findMany({
    where: taskId !== undefined ? eq(schema.tasks.id, taskId) : isNotNull(schema.tasks.githubUrl),
    columns: { id: true, githubUrl: true, goalId: true },
  });
  let changed = 0;
  for (const t of tasks) {
    changed += await linkOne(db, t);
  }
  return changed;
}

async function linkOne(db: Db, t: { id: number; githubUrl: string | null; goalId: number | null }): Promise<number> {
  let changed = 0;

  // 이 Task 에 붙어 있지만 url 이 더 이상 맞지 않는 활동은 연결만 푼다 (goal_id 는 남겨 사용자가 이어서 쓸 수 있게).
  const stale = await db
    .update(schema.activities)
    .set({ taskId: null })
    .where(
      and(
        eq(schema.activities.taskId, t.id),
        inArray(schema.activities.source, [...URL_LINKED_SOURCES]),
        t.githubUrl ? or(isNull(schema.activities.url), ne(schema.activities.url, t.githubUrl)) : undefined,
      ),
    )
    .returning({ id: schema.activities.id });
  changed += stale.length;

  if (!t.githubUrl) return changed;

  // url 이 같은 활동을 이 Task 에 붙이고 goal_id 를 Task 와 맞춘다.
  const linked = await db
    .update(schema.activities)
    .set({ taskId: t.id, goalId: t.goalId })
    .where(
      and(
        eq(schema.activities.url, t.githubUrl),
        inArray(schema.activities.source, [...URL_LINKED_SOURCES]),
        or(
          isNull(schema.activities.taskId),
          ne(schema.activities.taskId, t.id),
          t.goalId === null ? isNotNull(schema.activities.goalId) : or(isNull(schema.activities.goalId), ne(schema.activities.goalId, t.goalId)),
        ),
      ),
    )
    .returning({ id: schema.activities.id });
  changed += linked.length;

  // Task 가 직접 만든 완료 기록(task_status)도 같은 목표를 따른다.
  await db
    .update(schema.activities)
    .set({ goalId: t.goalId })
    .where(and(eq(schema.activities.taskId, t.id), eq(schema.activities.source, "task_status")));

  return changed;
}

/** Task 의 goal_id 가 바뀌었을 때 연결된 활동 전부의 goal_id 를 따라가게 한다. */
export async function propagateTaskGoal(db: Db, taskId: number, goalId: number | null): Promise<void> {
  await db.update(schema.activities).set({ goalId }).where(eq(schema.activities.taskId, taskId));
}
