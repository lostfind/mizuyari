import type {
  Activity,
  Epic,
  Goal,
  GoogleTodo,
  PeriodSummary,
  Report,
  SessionUser,
  Sprint,
  SprintDetail,
  SyncProvider,
  Task,
} from "$shared/types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent("mz:unauthorized"));
    throw new ApiError(401, "unauthorized");
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText, data?.details);
  return data as T;
}

const get = <T>(p: string) => request<T>("GET", p);
const post = <T>(p: string, b?: unknown) => request<T>("POST", p, b ?? {});
const patch = <T>(p: string, b: unknown) => request<T>("PATCH", p, b);
const put = <T>(p: string, b: unknown) => request<T>("PUT", p, b);
const del = <T>(p: string) => request<T>("DELETE", p);

export interface SyncStatus {
  provider: SyncProvider;
  at: string | null;
  result: string | null;
  error: string | null;
}

export interface TodayData {
  today: string;
  sprint: Sprint | null;
  goalSummary: { total: number; achieved: number; inProgress: number } | null;
  tasks: Task[];
  events: Activity[];
  /** Calendar colorId → 사용자가 붙인 라벨 */
  calendarLabels: Record<string, string>;
  openTodos: GoogleTodo[];
  recentTodos: Activity[];
}

export interface PeriodOption {
  key: string;
  label: string;
  kind: "quarter" | "half_year";
  periodStart: string;
  periodEnd: string;
}

export const api = {
  me: () => get<{ user: SessionUser | null; googleConnected?: boolean; googleNeedsReauth?: boolean }>("/auth/me"),
  logout: () => post<{ ok: true }>("/auth/logout"),
  config: () =>
    get<{ appName: string; fiscalYearStartMonth: number; reportLang: string; timezone: string; githubLogin: string | null }>("/api/config"),

  sprints: {
    list: () => get<Sprint[]>("/api/sprints"),
    current: () => get<SprintDetail | null>("/api/sprints/current"),
    get: (id: number) => get<SprintDetail>(`/api/sprints/${id}`),
    create: (b: { startDate: string; endDate?: string; meetingDate?: string | null }) => post<Sprint>("/api/sprints", b),
    update: (id: number, b: Partial<Pick<Sprint, "startDate" | "endDate" | "meetingDate" | "status">>) => patch<Sprint>(`/api/sprints/${id}`, b),
    close: (id: number) => post<Sprint>(`/api/sprints/${id}/close`),
    next: (id: number, b: { startDate?: string; carryGoalIds: number[]; closeCurrent: boolean; carryTasks: boolean }) => post<Sprint>(`/api/sprints/${id}/next`, b),
  },
  goals: {
    create: (b: Partial<Goal> & { sprintId: number; title: string }) => post<Goal>("/api/goals", b),
    update: (id: number, b: Partial<Goal>) => patch<Goal>(`/api/goals/${id}`, b),
    remove: (id: number) => del<{ ok: true }>(`/api/goals/${id}`),
  },
  epics: {
    list: (status?: string) => get<Epic[]>(`/api/epics${status ? `?status=${status}` : ""}`),
    get: (id: number) => get<{ epic: Epic; goals: Array<{ goal: Goal; sprint: Sprint }>; activities: Activity[] }>(`/api/epics/${id}`),
    create: (b: Partial<Epic> & { title: string }) => post<Epic>("/api/epics", b),
    update: (id: number, b: Partial<Epic>) => patch<Epic>(`/api/epics/${id}`, b),
    remove: (id: number) => del<{ ok: true }>(`/api/epics/${id}`),
  },
  tasks: {
    list: (q?: { status?: string; sprintId?: number }) => {
      const p = new URLSearchParams();
      if (q?.status) p.set("status", q.status);
      if (q?.sprintId) p.set("sprintId", String(q.sprintId));
      const s = p.toString();
      return get<Task[]>(`/api/tasks${s ? `?${s}` : ""}`);
    },
    create: (b: Partial<Task> & { title: string }) => post<Task>("/api/tasks", b),
    update: (id: number, b: Partial<Task>) => patch<Task>(`/api/tasks/${id}`, b),
    remove: (id: number) => del<{ ok: true }>(`/api/tasks/${id}`),
    importGithub: () => post<{ imported: number; promoted: number; total: number }>("/api/tasks/import-github"),
  },
  activities: {
    list: (q: { from?: string; to?: string; source?: string; goalId?: number; epicId?: number; unlinked?: boolean; limit?: number }) => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== false) p.set(k, v === true ? "1" : String(v));
      return get<Activity[]>(`/api/activities?${p}`);
    },
    create: (b: Partial<Activity> & { title: string }) => post<Activity>("/api/activities", b),
    update: (id: number, b: Partial<Pick<Activity, "goalId" | "epicId" | "taskId" | "isHighlight" | "isHidden" | "note" | "title">>) =>
      patch<Activity>(`/api/activities/${id}`, b),
    remove: (id: number) => del<{ ok: true }>(`/api/activities/${id}`),
  },
  reports: {
    list: (kind?: string) => get<Omit<Report, "markdown">[]>(`/api/reports${kind ? `?kind=${kind}` : ""}`),
    get: (id: number) => get<Report>(`/api/reports/${id}`),
    draftSprint: (sprintId: number, lang?: string) => post<Report>(`/api/reports/sprint/${sprintId}/draft`, { lang }),
    draftPeriod: (label: string, lang?: string) => post<Report>(`/api/reports/period/${label}/draft`, { lang }),
    update: (id: number, b: { markdown?: string; title?: string }) => patch<Report>(`/api/reports/${id}`, b),
    finalize: (id: number) => post<Report>(`/api/reports/${id}/finalize`),
    unfinalize: (id: number) => post<Report>(`/api/reports/${id}/unfinalize`),
  },
  periods: {
    list: () => get<{ current: { quarter: PeriodOption; half: PeriodOption }; periods: PeriodOption[] }>("/api/periods"),
    get: (label: string) => get<PeriodSummary>(`/api/periods/${label}`),
  },
  sync: {
    status: () => get<SyncStatus[]>("/api/sync/status"),
    run: (b?: { providers?: SyncProvider[]; from?: string; to?: string }) =>
      post<Array<{ provider: SyncProvider; ok: boolean; inserted: number; updated: number; error?: string }>>("/api/sync", b ?? {}),
    settings: () => get<Record<string, string>>("/api/sync/settings"),
    saveSettings: (b: Record<string, string>) => put<Record<string, string>>("/api/sync/settings", b),
  },
  today: () => get<TodayData>("/api/today"),
  todos: {
    list: () => get<GoogleTodo[]>("/api/todos"),
    refresh: () => post<{ count: number }>("/api/todos/refresh"),
    complete: (id: number) => post<{ ok: true; completedAt: string }>(`/api/todos/${id}/complete`),
    /** 완료 취소. id 는 완료 활동(google_task) 의 activity id */
    reopen: (activityId: number) => post<{ ok: true }>(`/api/todos/reopen/${activityId}`),
  },
};
