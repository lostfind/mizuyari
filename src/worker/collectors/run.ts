// 수집 실행: 수집기 호출 → activities upsert → sync_runs 기록.
// 기본 수집 범위는 직전 성공 시각 - 1일 ~ 지금. 처음이면 최근 30일.

import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { SyncProvider } from "$shared/types";
import type { Db } from "../db";
import { schema } from "../db";
import type { Env } from "../env";
import { getGoogleAccessToken } from "../auth/google";
import { dayRangeToIso, todayInTz } from "../lib/dates";
import { getCurrentSprint } from "../lib/queries";
import { linkActivitiesToTasks } from "../lib/taskLink";
import { collectGithub, fetchGithubStates, fetchOpenWorkItems } from "./github";
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
 * 스프린트가 없던 Task 는 현재 스프린트로 지정한다.
 * 완료 기록은 수집된 Issue closed / PR merged 활동이 대신하므로 task_status 활동은 만들지 않는다.
 */
export async function syncTaskGithubStates(db: Db, env: Env): Promise<number> {
  const rows = await db
    .select({ id: schema.tasks.id, githubUrl: schema.tasks.githubUrl, status: schema.tasks.status, sprintId: schema.tasks.sprintId })
    .from(schema.tasks)
    .where(and(isNotNull(schema.tasks.githubUrl), inArray(schema.tasks.status, ["backlog", "todo", "in_progress"])));
  if (rows.length === 0) return 0;
  const states = await fetchGithubStates(
    env.GITHUB_TOKEN,
    rows.map((r) => r.githubUrl!).filter(Boolean),
  );
  let changed = 0;
  const now = new Date().toISOString();
  // Backlog 에서 바로 닫힌 Task 처럼 스프린트가 없는 완료 Task 는 완료된 시점의 스프린트에 넣는다.
  const sprintId = (await getCurrentSprint(db, todayInTz(env.TIMEZONE)))?.id ?? null;
  for (const r of rows) {
    const s = states.get(r.githubUrl!);
    if (!s) continue;
    const closed = s.state !== "open";
    await db
      .update(schema.tasks)
      .set({
        githubState: s.state,
        ...(closed ? { status: "done" as const, sprintId: r.sprintId ?? sprintId } : {}),
        updatedAt: now,
      })
      .where(eq(schema.tasks.id, r.id));
    if (closed) changed++;
  }
  return changed;
}

/** 줄마다 하나인 정규식. 비어 있거나 잘못된 줄은 무시한다. 설정이 없으면 아무것도 제외하지 않는다. */
export function parseTitlePatterns(raw: string | null): RegExp[] {
  const out: RegExp[] = [];
  for (const line of (raw ?? "").split("\n")) {
    const p = line.trim();
    if (!p) continue;
    try {
      out.push(new RegExp(p));
    } catch {
      // 잘못된 패턴은 건너뛴다
    }
  }
  return out;
}

/**
 * GitHub 의 진행 대상(할당 Open Issue/PR, 내가 연 Open PR)을 Board 에 반영한다.
 * - 새 항목: 진행 중(열린 PR, 열린 PR 이 연결된 Issue)이면 현재 스프린트 + In Progress, 아니면 스프린트 없이 Backlog.
 * - 기존 Task: 이번에 새로 진행 중이 된 항목만 Backlog/Todo → In Progress 로 올린다.
 *   계속 진행 중인 항목을 매번 올리지 않으므로 사용자가 되돌린 배치는 유지된다.
 * - 제목이 제외 패턴에 맞는 항목은 가져오지 않는다.
 * 자동 동기화(`auto`)는 한 번 처리한 항목을 다시 만들지 않는다. 사용자가 Task 를 지웠다면 그 뜻을 따른다.
 */
export async function importGithubWork(
  db: Db,
  token: string,
  tz: string,
  opts: { auto?: boolean } = {},
): Promise<{ imported: number; promoted: number; total: number }> {
  const excludes = parseTitlePatterns(await readSetting(db, SETTING_KEYS.githubExcludeTitles));
  const items = (await fetchOpenWorkItems(token)).filter((i) => !excludes.some((re) => re.test(i.title)));
  const existing = await db.query.tasks.findMany({ columns: { id: true, githubUrl: true, status: true } });
  const byUrl = new Map(existing.filter((t) => t.githubUrl).map((t) => [t.githubUrl!, t]));
  const seen = new Set(readJsonArray(await readSetting(db, SETTING_KEYS.githubImportedIssues)));
  const wasInProgress = new Set(readJsonArray(await readSetting(db, SETTING_KEYS.githubInProgress)));
  const sprintId = (await getCurrentSprint(db, todayInTz(tz)))?.id ?? null;
  const now = new Date().toISOString();

  // 내가 연 PR 이 이미 있는 Task(직접 연결한 Issue 등)를 닫는 PR 이면 PR 대신 그 Task 를 진행 중으로 본다.
  const inProgressUrls = new Set<string>();
  const targets = [];
  for (const i of items) {
    const closesTask = i.closes.filter((u) => byUrl.has(u));
    if (!byUrl.has(i.url) && closesTask.length) {
      closesTask.forEach((u) => inProgressUrls.add(u));
      continue;
    }
    if (i.inProgress) inProgressUrls.add(i.url);
    targets.push(i);
  }

  let imported = 0;
  for (const i of targets) {
    if (byUrl.has(i.url) || (opts.auto && seen.has(i.url))) continue;
    const inProgress = inProgressUrls.has(i.url);
    await db.insert(schema.tasks).values({
      // 제목은 GitHub 제목 그대로. repo#번호 는 Board 가 github_url 에서 만들어 보여 준다.
      title: i.title,
      status: inProgress ? "in_progress" : "backlog",
      githubUrl: i.url,
      githubState: "open",
      sprintId: inProgress ? sprintId : null,
    });
    imported++;
  }

  let promoted = 0;
  for (const url of inProgressUrls) {
    const t = byUrl.get(url);
    if (!t || wasInProgress.has(url) || (t.status !== "backlog" && t.status !== "todo")) continue;
    await db
      .update(schema.tasks)
      .set({ status: "in_progress", sprintId, updatedAt: now })
      .where(eq(schema.tasks.id, t.id));
    promoted++;
  }

  // 지금 열려 있는 항목은 Task 가 있든(가져왔거나 직접 연결했거나) 방금 가져왔든 모두 처리된 것으로 본다.
  await writeSetting(db, SETTING_KEYS.githubImportedIssues, JSON.stringify(items.map((i) => i.url)));
  await writeSetting(db, SETTING_KEYS.githubInProgress, JSON.stringify([...inProgressUrls]));
  if (imported) await linkActivitiesToTasks(db);
  return { imported, promoted, total: items.length };
}

function readJsonArray(raw: string | null): string[] {
  try {
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
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
      // 닫힌 할당 Issue 수집을 추가하기 전에는 이 Issue 들이 빠져 있었다. 한 번만 최근 30일로 넓혀 백필한다.
      const backfillKey = "migrate:github_closed_issues_v1";
      const needBackfill = !opts.window && (await readSetting(db, backfillKey)) === null;
      const thirtyDaysAgo = new Date(Date.now() - 30 * DAY).toISOString();
      const ghWin = needBackfill && win.from > thirtyDaysAgo ? { from: thirtyDaysAgo, to: win.to } : win;
      const result = await runOne(db, provider, ghWin, async () => {
        const items = await collectGithub(env.GITHUB_TOKEN, env.GITHUB_LOGIN, ghWin);
        await importGithubWork(db, env.GITHUB_TOKEN, env.TIMEZONE, { auto: true });
        await syncTaskGithubStates(db, env);
        return items;
      });
      if (needBackfill && result.ok) await writeSetting(db, backfillKey, new Date().toISOString());
      results.push(result);
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
  /** 자동 가져오기에서 이미 처리한 할당 Issue URL JSON 배열 */
  githubImportedIssues: "github:imported_issues",
  /** 직전 동기화 때 진행 중이던 Issue/PR URL JSON 배열 (새로 진행 중이 된 것만 In Progress 로 올리기 위해) */
  githubInProgress: "github:in_progress",
  /** 가져오지 않을 Issue/PR 제목 정규식. 줄마다 하나 */
  githubExcludeTitles: "github:exclude_titles",
} as const;

export { sql };
