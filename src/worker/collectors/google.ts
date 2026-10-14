// Google Tasks: 완료된 TODO. Google Calendar: 참석한 일정.

import type { CollectWindow, CollectedActivity } from "./types";

async function gfetch<T>(accessToken: string, url: string): Promise<T> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Google API ${res.status} ${url.split("?")[0]}: ${await res.text()}`);
  return (await res.json()) as T;
}

interface TaskList {
  id: string;
  title: string;
}
interface GTask {
  id: string;
  title: string;
  status: "needsAction" | "completed";
  completed?: string;
  due?: string;
  updated: string;
  notes?: string;
  webViewLink?: string;
  deleted?: boolean;
}

export async function collectGoogleTasks(accessToken: string, win: CollectWindow): Promise<CollectedActivity[]> {
  const lists = await gfetch<{ items?: TaskList[] }>(
    accessToken,
    "https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100",
  );
  const out: CollectedActivity[] = [];
  for (const list of lists.items ?? []) {
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        showCompleted: "true",
        showHidden: "true", // 웹/앱에서 완료한 TODO 는 hidden 처리되므로 필수
        showAssigned: "true", // Docs/Chat 에서 할당된 TODO 포함
        completedMin: win.from,
        completedMax: win.to,
        maxResults: "100",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const page = await gfetch<{ items?: GTask[]; nextPageToken?: string }>(
        accessToken,
        `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(list.id)}/tasks?${params}`,
      );
      for (const t of page.items ?? []) {
        if (t.status !== "completed" || !t.completed || t.deleted) continue;
        if (!t.title?.trim()) continue;
        out.push({
          source: "google_task",
          externalId: `${list.id}:${t.id}`,
          title: `TODO 완료 · ${t.title.trim()}`,
          url: t.webViewLink ?? null,
          occurredAt: t.completed,
          metadata: { list: list.title, due: t.due ?? null, notes: t.notes ?? null },
        });
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
  }
  return out;
}

export interface OpenTodo {
  listId: string;
  listTitle: string;
  taskId: string;
  title: string;
  notes: string | null;
  due: string | null;
  webViewLink: string | null;
  position: string;
  updated: string;
}

/** 미완료 TODO 전체 (Today 화면용). */
export async function fetchOpenGoogleTodos(accessToken: string): Promise<OpenTodo[]> {
  const lists = await gfetch<{ items?: TaskList[] }>(
    accessToken,
    "https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100",
  );
  const out: OpenTodo[] = [];
  for (const list of lists.items ?? []) {
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ showCompleted: "false", showAssigned: "true", maxResults: "100" });
      if (pageToken) params.set("pageToken", pageToken);
      const page = await gfetch<{ items?: Array<GTask & { position?: string }>; nextPageToken?: string }>(
        accessToken,
        `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(list.id)}/tasks?${params}`,
      );
      for (const t of page.items ?? []) {
        if (t.status !== "needsAction" || t.deleted || !t.title?.trim()) continue;
        out.push({
          listId: list.id,
          listTitle: list.title,
          taskId: t.id,
          title: t.title.trim(),
          notes: t.notes ?? null,
          due: t.due ?? null,
          webViewLink: t.webViewLink ?? null,
          position: t.position ?? "",
          updated: t.updated,
        });
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
  }
  return out;
}

/** TODO 의 완료 상태를 바꾼다 (완료 / 완료 취소). Google Tasks 에 하는 유일한 쓰기. 갱신된 TODO 를 돌려준다. */
export async function setGoogleTodoCompleted(
  accessToken: string,
  listId: string,
  taskId: string,
  completed: boolean,
): Promise<GTask & { position?: string }> {
  const url = `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    // 완료 취소 시 completed 시각도 함께 지워야 needsAction 으로 돌아간다.
    body: JSON.stringify(completed ? { status: "completed" } : { status: "needsAction", completed: null }),
  });
  if (!res.ok) throw new Error(`Google Tasks PATCH ${res.status}: ${await res.text()}`);
  return (await res.json()) as GTask & { position?: string };
}

/** 리스트 제목 조회 (완료 취소로 스냅샷에 되돌릴 때 필요). 없으면 null. */
export async function fetchGoogleTaskListTitle(accessToken: string, listId: string): Promise<string | null> {
  const res = await fetch(`https://tasks.googleapis.com/tasks/v1/users/@me/lists/${encodeURIComponent(listId)}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const list = (await res.json()) as TaskList;
  return list.title ?? null;
}

interface GEvent {
  id: string;
  status: string;
  summary?: string;
  htmlLink?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
  organizer?: { self?: boolean };
  eventType?: string;
  transparency?: string;
}

export interface CalendarOptions {
  /** 제외할 제목 키워드 (대소문자 무시). 집중 시간, 점심 등 */
  excludeKeywords?: string[];
}

export async function collectGoogleCalendar(
  accessToken: string,
  win: CollectWindow,
  opts: CalendarOptions = {},
): Promise<CollectedActivity[]> {
  const exclude = (opts.excludeKeywords ?? []).map((k) => k.toLowerCase()).filter(Boolean);
  const out: CollectedActivity[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      timeMin: win.from,
      timeMax: win.to,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
      eventTypes: "default",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await gfetch<{ items?: GEvent[]; nextPageToken?: string }>(
      accessToken,
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    );
    for (const e of page.items ?? []) {
      if (e.status === "cancelled") continue;
      if (!e.start.dateTime) continue; // 종일 일정 제외
      const title = (e.summary ?? "").trim();
      if (!title) continue;
      if (exclude.some((k) => title.toLowerCase().includes(k))) continue;
      // 거절한 일정 제외
      const me = e.attendees?.find((a) => a.self);
      if (me?.responseStatus === "declined") continue;
      // 본인 혼자인 일정(참석자 없음, 본인이 주최)은 미팅이 아닌 블록으로 보고 제외
      if (!e.attendees?.length && e.organizer?.self) continue;
      if (e.transparency === "transparent") continue;

      out.push({
        source: "calendar_event",
        externalId: e.id,
        title: `미팅 · ${title}`,
        url: e.htmlLink ?? null,
        occurredAt: e.start.dateTime,
        metadata: { end: e.end.dateTime ?? null, attendees: e.attendees?.length ?? 0 },
      });
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}
