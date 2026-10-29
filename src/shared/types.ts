// 클라이언트와 Worker가 공유하는 타입. DB 스키마와 1:1은 아니고 API 응답 형태다.

export const EPIC_STATUSES = ["active", "paused", "done"] as const;
export type EpicStatus = (typeof EPIC_STATUSES)[number];

export const SPRINT_STATUSES = ["active", "closed"] as const;
export type SprintStatus = (typeof SPRINT_STATUSES)[number];

export const GOAL_STATUSES = ["not_started", "in_progress", "achieved", "partial", "dropped"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const TASK_STATUSES = ["backlog", "todo", "in_progress", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "normal", "high"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const ACTIVITY_SOURCES = [
  "github_issue",
  "github_pr",
  "github_review",
  "task_status",
  "google_task",
  "calendar_event",
  "manual",
] as const;
export type ActivitySource = (typeof ACTIVITY_SOURCES)[number];

export const REPORT_KINDS = ["sprint", "quarter", "half_year"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/** GitHub 가져오기 기본 제외 패턴 (줄마다 정규식): 할당은 되어 있지만 직접 관련이 없는 릴리스 PR (`Release 20261026151701`) */
export const DEFAULT_GITHUB_EXCLUDE_TITLES = "^Release \\d{14}$";

export const SYNC_PROVIDERS = ["github", "google_tasks", "google_calendar"] as const;
export type SyncProvider = (typeof SYNC_PROVIDERS)[number];

export interface Epic {
  id: number;
  title: string;
  description: string | null;
  status: EpicStatus;
  progressNote: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface Sprint {
  id: number;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD (inclusive)
  meetingDate: string | null;
  status: SprintStatus;
  createdAt: string;
}

export interface Goal {
  id: number;
  sprintId: number;
  epicId: number | null;
  title: string;
  description: string | null;
  successCriteria: string | null;
  status: GoalStatus;
  progressNote: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  sprintId: number | null;
  goalId: number | null;
  githubUrl: string | null;
  githubState: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface Activity {
  id: number;
  source: ActivitySource;
  externalId: string;
  title: string;
  url: string | null;
  occurredAt: string; // ISO datetime
  metadata: Record<string, unknown> | null;
  goalId: number | null;
  taskId: number | null;
  epicId: number | null;
  isHighlight: boolean;
  isHidden: boolean;
  note: string | null;
  createdAt: string;
}

/** 미정·거절 응답의 캘린더 일정은 Today 에만 보이고 Sprint 활동·리포트·기간 집계에서는 숨긴 것으로 다룬다. */
export const AUTO_HIDDEN_CALENDAR_RESPONSES = ["tentative", "declined"] as const;

/** 응답 상태 때문에 자동으로 숨겨지는 활동인지. 응답이 바뀌면 다음 동기화 뒤 자동으로 다시 보인다. */
export function autoHiddenReason(a: Pick<Activity, "source" | "metadata">): "tentative" | "declined" | null {
  if (a.source !== "calendar_event") return null;
  const r = a.metadata?.response;
  return (AUTO_HIDDEN_CALENDAR_RESPONSES as readonly unknown[]).includes(r) ? (r as "tentative" | "declined") : null;
}

/** 사용자가 숨겼거나 응답 상태로 자동 숨김인 활동 */
export function isEffectivelyHidden(a: Pick<Activity, "source" | "metadata" | "isHidden">): boolean {
  return a.isHidden || autoHiddenReason(a) !== null;
}

export interface Report {
  id: number;
  sprintId: number | null;
  kind: ReportKind;
  periodStart: string;
  periodEnd: string;
  title: string;
  markdown: string;
  finalizedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyncRun {
  id: number;
  provider: SyncProvider;
  startedAt: string;
  finishedAt: string | null;
  result: string | null;
  error: string | null;
  inserted: number;
  updated: number;
}

export interface GoogleTodo {
  id: number;
  listId: string;
  listTitle: string;
  taskId: string;
  title: string;
  notes: string | null;
  due: string | null;
  webViewLink: string | null;
  position: string;
  updated: string;
  syncedAt: string;
}

export interface SessionUser {
  email: string;
  name: string | null;
  picture: string | null;
}

export interface GoalWithActivities extends Goal {
  activities: Activity[];
  epic: Pick<Epic, "id" | "title"> | null;
}

export interface SprintDetail {
  sprint: Sprint;
  goals: GoalWithActivities[];
  unlinkedActivities: Activity[];
  /** 숨긴 활동 (목표 연결 여부와 무관, 스프린트 기간 내 + 이 스프린트 목표에 연결된 것) */
  hiddenActivities: Activity[];
  tasks: Task[];
}

export interface PeriodSummary {
  label: string; // e.g. "FY2026 1Q"
  periodStart: string;
  periodEnd: string;
  sprints: Sprint[];
  goalCounts: Record<GoalStatus, number>;
  epics: Array<{
    epic: Epic;
    goals: Goal[];
    activities: Activity[];
  }>;
  highlights: Activity[];
  reports: Report[];
}
