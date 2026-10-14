import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  ACTIVITY_SOURCES,
  EPIC_STATUSES,
  GOAL_STATUSES,
  REPORT_KINDS,
  SPRINT_STATUSES,
  SYNC_PROVIDERS,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from "$shared/types";

// 날짜 컬럼은 ISO 문자열로 저장한다 (SQLite는 날짜 타입이 없다).
// YYYY-MM-DD 는 text, datetime 은 ISO 8601 UTC 문자열.
const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const epics = sqliteTable("epics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status", { enum: EPIC_STATUSES }).notNull().default("active"),
  progressNote: text("progress_note"),
  order: integer("order").notNull().default(0),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
});

export const sprints = sqliteTable(
  "sprints",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    meetingDate: text("meeting_date"),
    status: text("status", { enum: SPRINT_STATUSES }).notNull().default("active"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("sprints_start_date_idx").on(t.startDate)],
);

export const goals = sqliteTable(
  "goals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sprintId: integer("sprint_id")
      .notNull()
      .references(() => sprints.id, { onDelete: "cascade" }),
    epicId: integer("epic_id").references(() => epics.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description"),
    successCriteria: text("success_criteria"),
    status: text("status", { enum: GOAL_STATUSES }).notNull().default("not_started"),
    progressNote: text("progress_note"),
    order: integer("order").notNull().default(0),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [index("goals_sprint_idx").on(t.sprintId), index("goals_epic_idx").on(t.epicId)],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status", { enum: TASK_STATUSES }).notNull().default("todo"),
    priority: text("priority", { enum: TASK_PRIORITIES }).notNull().default("normal"),
    dueDate: text("due_date"),
    sprintId: integer("sprint_id").references(() => sprints.id, { onDelete: "set null" }),
    goalId: integer("goal_id").references(() => goals.id, { onDelete: "set null" }),
    githubUrl: text("github_url"),
    githubState: text("github_state"), // open / closed / merged — 동기화로 채움
    order: integer("order").notNull().default(0),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [
    index("tasks_sprint_idx").on(t.sprintId),
    index("tasks_goal_idx").on(t.goalId),
    index("tasks_status_idx").on(t.status),
    uniqueIndex("tasks_github_url_uq").on(t.githubUrl),
  ],
);

export const activities = sqliteTable(
  "activities",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    source: text("source", { enum: ACTIVITY_SOURCES }).notNull(),
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    url: text("url"),
    occurredAt: text("occurred_at").notNull(),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    goalId: integer("goal_id").references(() => goals.id, { onDelete: "set null" }),
    taskId: integer("task_id").references(() => tasks.id, { onDelete: "set null" }),
    epicId: integer("epic_id").references(() => epics.id, { onDelete: "set null" }),
    isHighlight: integer("is_highlight", { mode: "boolean" }).notNull().default(false),
    note: text("note"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("activities_source_external_uq").on(t.source, t.externalId),
    index("activities_occurred_idx").on(t.occurredAt),
    index("activities_goal_idx").on(t.goalId),
    index("activities_epic_idx").on(t.epicId),
  ],
);

export const reports = sqliteTable(
  "reports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sprintId: integer("sprint_id").references(() => sprints.id, { onDelete: "set null" }),
    kind: text("kind", { enum: REPORT_KINDS }).notNull(),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    title: text("title").notNull(),
    markdown: text("markdown").notNull().default(""),
    finalizedAt: text("finalized_at"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [index("reports_period_idx").on(t.periodStart, t.periodEnd), index("reports_sprint_idx").on(t.sprintId)],
);

// 리포트 수정 이력. 확정 전 저장할 때마다 한 줄씩 쌓인다.
export const reportVersions = sqliteTable(
  "report_versions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    reportId: integer("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    markdown: text("markdown").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("report_versions_report_idx").on(t.reportId)],
);

// 런타임에 갱신되는 토큰만 저장한다 (Google OAuth refresh/access token).
// 고정 비밀(client_secret, GitHub PAT)은 Workers Secrets에 둔다.
export const credentials = sqliteTable("credentials", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  provider: text("provider").notNull().unique(), // "google"
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  encryptedAccessToken: text("encrypted_access_token"),
  accessTokenExpiresAt: text("access_token_expires_at"),
  scopes: text("scopes").notNull(),
  accountEmail: text("account_email"),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
});

export const syncRuns = sqliteTable(
  "sync_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider", { enum: SYNC_PROVIDERS }).notNull(),
    startedAt: text("started_at").notNull().default(now),
    finishedAt: text("finished_at"),
    result: text("result"), // ok / error
    error: text("error"),
    inserted: integer("inserted").notNull().default(0),
    updated: integer("updated").notNull().default(0),
  },
  (t) => [index("sync_runs_provider_idx").on(t.provider, t.startedAt)],
);

// Google Tasks 의 미완료 TODO 스냅샷. 완료된 것은 activities(google_task) 로 옮겨지고 여기서 지워진다.
export const googleTodos = sqliteTable(
  "google_todos",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    listId: text("list_id").notNull(),
    listTitle: text("list_title").notNull(),
    taskId: text("task_id").notNull(),
    title: text("title").notNull(),
    notes: text("notes"),
    due: text("due"), // RFC3339 (Google 은 날짜만 의미 있음)
    webViewLink: text("web_view_link"),
    position: text("position").notNull().default(""),
    updated: text("updated").notNull(),
    syncedAt: text("synced_at").notNull().default(now),
  },
  (t) => [uniqueIndex("google_todos_list_task_uq").on(t.listId, t.taskId), index("google_todos_due_idx").on(t.due)],
);

// 수집 커서 등 소규모 설정값.
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(now),
});
