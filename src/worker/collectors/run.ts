// 수집 실행: 수집기 호출 → activities upsert → sync_runs 기록.
// 기본 수집 범위는 직전 성공 시각 - 1일 ~ 지금. 처음이면 최근 30일.

import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { SyncProvider } from "$shared/types";
import type { Db } from "../db";
import { schema } from "../db";
import type { Env } from "../env";
import { getGoogleAccessToken } from "../auth/google";
import { dayRangeToIso, todayInTz } from "../lib/dates";
import { linkActivitiesToTasks } from "../lib/taskLink";
import { collectGithub, fetchGithubStates } from "./github";
import { collectGoogleCalendar, collectGoogleTasks, fetchOpenGoogleTodos } from "./google";
import type { CollectWindow, CollectedActivity } from "./types";

const DAY = 86_400_000;

export interface SyncResult {
  provider: SyncProvider;
  ok: boolean;
  inserted: number;
  updated: number;
  error?: string;
  window: CollectWindow;
}

async function readSetting(db: Db, key: string): Promise<string | null> {
  const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, key) });
  return row?.value ?? null;
}

async function writeSetting(db: Db, key: string, value: string): Promise<void> {
  await db
    .insert(schema.settings)
    .values({ key, value, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value, updatedAt: new Date().toISOString() },
    });
}

export async function defaultWindow(db: Db, provider: SyncProvider, now = new Date()): Promise<CollectWindow> {
  const last = await readSetting(db, `sync:${provider}:last_success`);
  const from = last ? new Date(new Date(last).getTime() - DAY) : new Date(now.getTime() - 30 * DAY);
  return { from: from.toISOString(), to: now.toISOString() };
}

/** (source, external_id) 기준 upsert. 제목·URL·시각·metadata 만 갱신하고 사용자가 붙인 goal/note 는 보존한다. */
export async function upsertActivities(
  db: Db,
  items: CollectedActivity[],
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;
  for (const item of items) {
    // 시각 비교·기간 조회가 문자열 비교이므로 UTC ISO 로 맞춘다 (Calendar 는 +09:00 형식으로 온다).
    const a = { ...item, occurredAt: new Date(item.occurredAt).toISOString() };
    const existing = await db.query.activities.findFirst({
      where: and(eq(schema.activities.source, a.source), eq(schema.activities.externalId, a.externalId)),
      columns: { id: true, title: true, occurredAt: true, url: true, metadata: true },
    });
    if (!existing) {
      await db.insert(schema.activities).values({
        source: a.source,
        externalId: a.externalId,
        title: a.title,
        url: a.url,
        occurredAt: a.occurredAt,
        metadata: a.metadata ?? null,
      });
      inserted++;
    } else if (
      existing.title !== a.title ||
      existing.occurredAt !== a.occurredAt ||
      existing.url !== a.url ||
      JSON.stringify(existing.metadata ?? null) !== JSON.stringify(a.metadata ?? null)
    ) {
      await db
        .update(schema.activities)
        .set({ title: a.title, url: a.url, occurredAt: a.occurredAt, metadata: a.metadata ?? null })
        .where(eq(schema.activities.id, existing.id));
      updated++;
    }
  }
  return { inserted, updated };
}

async function runOne(
  db: Db,
  provider: SyncProvider,
  win: CollectWindow,
  collect: () => Promise<CollectedActivity[]>,
): Promise<SyncResult> {
  const [run] = await db.insert(schema.syncRuns).values({ provider }).returning({ id: schema.syncRuns.id });
  try {
    const items = await collect();
    const { inserted, updated } = await upsertActivities(db, items);
    await db
      .update(schema.syncRuns)
      .set({ finishedAt: new Date().toISOString(), result: "ok", inserted, updated })
      .where(eq(schema.syncRuns.id, run.id));
    await writeSetting(db, `sync:${provider}:last_success`, win.to);
    return { provider, ok: true, inserted, updated, window: win };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(schema.syncRuns)
      .set({ finishedAt: new Date().toISOString(), result: "error", error: message.slice(0, 2000) })
      .where(eq(schema.syncRuns.id, run.id));
    return { provider, ok: false, inserted: 0, updated: 0, error: message, window: win };
  }
}

/**
 * 거절·취소된 일정을 지운다. 사용자가 목표·메모·하이라이트를 붙인 행은 지우지 않고
 * metadata.response 만 declined 로 바꿔 화면에서 숨긴다.
 */
async function removeCalendarEvents(db: Db, externalIds: string[]): Promise<void> {
  for (const externalId of externalIds) {
    const row = await db.query.activities.findFirst({
      where: and(eq(schema.activities.source, "calendar_event"), eq(schema.activities.externalId, externalId)),
    });
    if (!row) continue;
    const annotated = row.goalId !== null || row.taskId !== null || row.epicId !== null || row.isHighlight || !!row.note;
    if (annotated) {
      if (row.metadata?.response === "declined") continue;
      await db
        .update(schema.activities)
        .set({ metadata: { ...(row.metadata ?? {}), response: "declined" } })
        .where(eq(schema.activities.id, row.id));
    } else {
      await db.delete(schema.activities).where(eq(schema.activities.id, row.id));
    }
  }
}

/**
 * 미완료 Google TODO 스냅샷을 갱신한다. 더 이상 열려 있지 않은 행은 지운다.
 * Google 쪽에서 완료를 취소한 TODO 는 다시 미완료가 되므로, 남아 있는 완료 활동(google_task)을 지워
 * 같은 TODO 가 완료 이력과 미완료로 둘 다 보이지 않게 한다.
 * 돌려주는 값: 현재 열려 있는 TODO 의 `listId:taskId` 집합.
 */
export async function refreshOpenTodos(db: Db, accessToken: string): Promise<Set<string>> {
  const open = await fetchOpenGoogleTodos(accessToken);
  const now = new Date().toISOString();
  const keep = new Set<string>();
  for (const t of open) {
    keep.add(`${t.listId}:${t.taskId}`);
    await db
      .insert(schema.googleTodos)
      .values({ ...t, syncedAt: now })
      .onConflictDoUpdate({
        target: [schema.googleTodos.listId, schema.googleTodos.taskId],
        set: { title: t.title, notes: t.notes, due: t.due, webViewLink: t.webViewLink, position: t.position, updated: t.updated, listTitle: t.listTitle, syncedAt: now },
      });
  }
  const existing = await db.select({ id: schema.googleTodos.id, listId: schema.googleTodos.listId, taskId: schema.googleTodos.taskId }).from(schema.googleTodos);
  const stale = existing.filter((r) => !keep.has(`${r.listId}:${r.taskId}`)).map((r) => r.id);
  if (stale.length) await db.delete(schema.googleTodos).where(inArray(schema.googleTodos.id, stale));
  await deleteReopenedTodoActivities(db, keep);
  return keep;
}

/** 열려 있는 TODO 와 같은 external_id 를 가진 완료 활동을 지운다 (Google 에서 완료 취소된 경우). */
export async function deleteReopenedTodoActivities(db: Db, openKeys: Set<string>): Promise<number> {
  if (openKeys.size === 0) return 0;
  const keys = [...openKeys];
  let deleted = 0;
  // SQLite 바인딩 한도를 피하려고 나눠서 지운다.
  for (let i = 0; i < keys.length; i += 50) {
    const r = await db
      .delete(schema.activities)
      .where(and(eq(schema.activities.source, "google_task"), inArray(schema.activities.externalId, keys.slice(i, i + 50))))
      .returning({ id: schema.activities.id });
    deleted += r.length;
  }
  return deleted;
}

/**
 * Task 에 연결된 GitHub Issue/PR 상태를 동기화하고, 닫히면 Task 를 done 으로 옮긴다.
 * 완료 기록은 수집된 Issue closed / PR merged 활동이 대신하므로 task_status 활동은 만들지 않는다.
 */
export async function syncTaskGithubStates(db: Db, env: Env): Promise<number> {
  const rows = await db
    .select({ id: schema.tasks.id, githubUrl: schema.tasks.githubUrl, status: schema.tasks.status })
    .from(schema.tasks)
    .where(and(isNotNull(schema.tasks.githubUrl), inArray(schema.tasks.status, ["backlog", "todo", "in_progress"])));
  if (rows.length === 0) return 0;
  const states = await fetchGithubStates(
    env.GITHUB_TOKEN,
    rows.map((r) => r.githubUrl!).filter(Boolean),
  );
  let changed = 0;
  const now = new Date().toISOString();
  for (const r of rows) {
    const s = states.get(r.githubUrl!);
    if (!s) continue;
    const closed = s.state !== "open";
    await db
      .update(schema.tasks)
      .set({
        githubState: s.state,
        ...(closed ? { status: "done" as const } : {}),
        updatedAt: now,
      })
      .where(eq(schema.tasks.id, r.id));
    if (closed) changed++;
  }
  return changed;
}

/**
 * 한 번만 도는 정리: 예전에는 GitHub 연결 Task 가 done 될 때도 task_status 활동을 만들어 Issue closed 와 겹쳤다.
 * 메모·하이라이트가 없는 중복 행을 지운다. 완료 여부는 settings 에 남긴다.
 */
async function cleanupDuplicateTaskStatus(db: Db): Promise<number> {
  const key = "migrate:task_link_v1";
  if ((await readSetting(db, key)) !== null) return 0;
  const linkedTasks = await db.query.tasks.findMany({ where: isNotNull(schema.tasks.githubUrl), columns: { id: true } });
  let deleted = 0;
  for (const t of linkedTasks) {
    const r = await db
      .delete(schema.activities)
      .where(
        and(
          eq(schema.activities.source, "task_status"),
          eq(schema.activities.externalId, `${t.id}:done`),
          eq(schema.activities.isHighlight, false),
          sql`coalesce(${schema.activities.note}, '') = ''`,
        ),
      )
      .returning({ id: schema.activities.id });
    deleted += r.length;
  }
  await writeSetting(db, key, new Date().toISOString());
  return deleted;
}

export interface SyncOptions {
  providers?: SyncProvider[];
  window?: CollectWindow;
}

export async function runSync(db: Db, env: Env, opts: SyncOptions = {}): Promise<SyncResult[]> {
  const providers = opts.providers ?? ["github", "google_tasks", "google_calendar"];
  const results: SyncResult[] = [];
  const excludeRaw = await readSetting(db, "calendar:exclude_keywords");
  const excludeKeywords = excludeRaw ? excludeRaw.split(",").map((s) => s.trim()) : [];

  for (const provider of providers) {
    const win = opts.window ?? (await defaultWindow(db, provider));
    if (provider === "github") {
      if (!env.GITHUB_TOKEN || !env.GITHUB_LOGIN) {
        results.push({ provider, ok: false, inserted: 0, updated: 0, error: "GITHUB_TOKEN/GITHUB_LOGIN not set", window: win });
        continue;
      }
      results.push(
        await runOne(db, provider, win, async () => {
          const items = await collectGithub(env.GITHUB_TOKEN, env.GITHUB_LOGIN, win);
          await syncTaskGithubStates(db, env);
          return items;
        }),
      );
    } else if (provider === "google_tasks") {
      results.push(
        await runOne(db, provider, win, async () => {
          const token = await getGoogleAccessToken(db, env);
          const items = await collectGoogleTasks(token, win);
          const open = await refreshOpenTodos(db, token);
          // 완료 후 다시 열린 TODO 는 완료 활동으로 남기지 않는다.
          return items.filter((a) => !open.has(a.externalId));
        }),
      );
    } else if (provider === "google_calendar") {
      results.push(
        await runOne(db, provider, win, async () => {
          const token = await getGoogleAccessToken(db, env);
          // Today 화면에 오늘 남은 일정도 보이도록 오늘 끝까지 가져온다. last_success 는 win.to(지금) 그대로 둔다.
          const endOfToday = dayRangeToIso(todayInTz(env.TIMEZONE), todayInTz(env.TIMEZONE), env.TIMEZONE).to;
          const calWin = { from: win.from, to: win.to > endOfToday ? win.to : endOfToday };
          const { items, removedIds, palette } = await collectGoogleCalendar(token, calWin, { excludeKeywords });
          await writeSetting(db, SETTING_KEYS.calendarPalette, JSON.stringify(palette));
          await removeCalendarEvents(db, removedIds);
          return items;
        }),
      );
    }
  }
  // 수집된 활동을 Task 와 잇고 goal_id 를 Task 에 맞춘다 (멱등).
  await linkActivitiesToTasks(db);
  await cleanupDuplicateTaskStatus(db);
  return results;
}

export async function lastSyncInfo(db: Db): Promise<Array<{ provider: SyncProvider; at: string | null; result: string | null; error: string | null }>> {
  const providers: SyncProvider[] = ["github", "google_tasks", "google_calendar"];
  const out = [];
  for (const provider of providers) {
    const row = await db.query.syncRuns.findFirst({
      where: eq(schema.syncRuns.provider, provider),
      orderBy: (t, { desc }) => [desc(t.startedAt)],
    });
    out.push({ provider, at: row?.finishedAt ?? row?.startedAt ?? null, result: row?.result ?? null, error: row?.error ?? null });
  }
  return out;
}

// 참고용: 설정 키 목록
export const SETTING_KEYS = {
  calendarExcludeKeywords: "calendar:exclude_keywords",
  /** colorId → 배경색 JSON. 동기화 때 갱신 */
  calendarPalette: "calendar:palette",
  /** colorId → 사용자가 붙인 라벨 JSON */
  calendarColorLabels: "calendar:color_labels",
} as const;

export { sql };
