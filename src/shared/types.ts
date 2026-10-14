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
  note: string | null;
  createdAt: string;
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
