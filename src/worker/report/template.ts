// 리포트 마크다운 생성. Claude 없이 템플릿만으로 초안을 만든다.
// 출력 언어: ko (기본) / ja

import type { Activity, Epic, Goal, GoalStatus, Sprint, SprintDetail } from "$shared/types";

type Lang = "ko" | "ja";

const T = {
  ko: {
    sprintTitle: (s: string, e: string) => `# 컨디셔닝 미팅 리포트 (${s} 〜 ${e})`,
    goalsH: "## 1. 목표별 진척",
    goalH: (i: number, t: string) => `### 목표 ${i}: ${t}`,
    status: "상태",
    progress: "진척",
    actions: "달성을 위한 행동",
    next: "다음 2주에 이어갈 점",
    outsideH: "## 2. 목표 이외의 행동·성과",
    nextGoalsH: "## 3. 다음 2주 목표 (안)",
    appendixH: "## 부록: 수집된 활동 목록",
    none: "(해당 없음)",
    todo: "<작성>",
    epic: "Epic",
    tableHead: "| 날짜 | 출처 | 내용 | 연결된 목표 |\n| --- | --- | --- | --- |",
    statusLabel: {
      not_started: "미착수",
      in_progress: "진행중",
      achieved: "달성",
      partial: "부분달성",
      dropped: "중단",
    } as Record<GoalStatus, string>,
    periodTitle: (label: string, s: string, e: string) => `# ${label} 성과 리포트 (${s} 〜 ${e})`,
    summaryH: "## 1. 기간 요약",
    sprintsLine: (n: number, a: number, p: number, m: number) =>
      `- 스프린트 ${n}회, 목표 달성 ${a} / 부분달성 ${p} / 미달 ${m}`,
    oneLine: "- 한 줄 요약: <이 기간의 핵심 성과>",
    epicsH: "## 2. Epic별 성과",
    epicProgress: "이 기간의 진척",
    relatedGoals: "관련 목표",
    keyActions: "주요 행동",
    highlightsH: "## 3. 목표 이외의 주요 성과",
    nextPeriodH: "## 4. 다음 기간 과제",
    noEpic: "(Epic 없음)",
  },
  ja: {
    sprintTitle: (s: string, e: string) => `# コンディショニングMTG レポート (${s} 〜 ${e})`,
    goalsH: "## 1. 目標ごとの進捗",
    goalH: (i: number, t: string) => `### 目標 ${i}: ${t}`,
    status: "状態",
    progress: "進捗",
    actions: "達成のための行動",
    next: "次の2週間に引き継ぐこと",
    outsideH: "## 2. 目標以外の行動・成果",
    nextGoalsH: "## 3. 次の2週間の目標 (案)",
    appendixH: "## 付録: 収集した活動一覧",
    none: "(該当なし)",
    todo: "<記入>",
    epic: "Epic",
    tableHead: "| 日付 | 出所 | 内容 | 紐づく目標 |\n| --- | --- | --- | --- |",
    statusLabel: {
      not_started: "未着手",
      in_progress: "進行中",
      achieved: "達成",
      partial: "一部達成",
      dropped: "中止",
    } as Record<GoalStatus, string>,
    periodTitle: (label: string, s: string, e: string) => `# ${label} 成果レポート (${s} 〜 ${e})`,
    summaryH: "## 1. 期間サマリー",
    sprintsLine: (n: number, a: number, p: number, m: number) =>
      `- スプリント ${n}回、目標 達成 ${a} / 一部達成 ${p} / 未達 ${m}`,
    oneLine: "- 一行サマリー: <この期間の主要な成果>",
    epicsH: "## 2. Epicごとの成果",
    epicProgress: "この期間の進捗",
    relatedGoals: "関連目標",
    keyActions: "主な行動",
    highlightsH: "## 3. 目標以外の主な成果",
    nextPeriodH: "## 4. 次期の課題",
    noEpic: "(Epicなし)",
  },
} as const;

function fmtDate(iso: string, tz: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "2-digit", day: "2-digit" }).format(d).replace("/", "/");
}

function sourceLabel(a: Activity): string {
  switch (a.source) {
    case "github_issue":
      return "Issue";
    case "github_pr":
      return "PR";
    case "github_review":
      return "Review";
    case "task_status":
      return "Task";
    case "google_task":
      return "TODO";
    case "calendar_event":
      return "Calendar";
    default:
      return "Manual";
  }
}

/** 활동 제목은 외부인이 정할 수 있으므로 마크다운 링크 문법으로 해석되지 않게 이스케이프한다. */
function mdText(s: string): string {
  return s.replace(/([\\[\]])/g, "\\$1");
}

/** 마크다운 링크 대상. 괄호·공백이 링크를 끊지 않도록 인코딩한다. */
function mdUrl(u: string): string {
  return u.replace(/[()\s]/g, (ch) => encodeURIComponent(ch));
}

function activityLine(a: Activity, tz: string): string {
  const ref = a.metadata && typeof a.metadata.number === "number" ? `#${a.metadata.number}` : sourceLabel(a);
  const link = a.url ? `[${ref}](${mdUrl(a.url)})` : ref;
  const note = a.note ? ` — ${a.note}` : "";
  return `- ${mdText(a.title)}${note} (${link}, ${fmtDate(a.occurredAt, tz)})`;
}

export function renderSprintReport(detail: SprintDetail, lang: Lang, tz: string): string {
  const t = T[lang];
  const { sprint, goals, unlinkedActivities } = detail;
  const lines: string[] = [];
  lines.push(t.sprintTitle(sprint.startDate, sprint.endDate), "");
  lines.push(t.goalsH, "");

  if (goals.length === 0) lines.push(t.none, "");
  goals.forEach((g, i) => {
    lines.push(t.goalH(i + 1, g.title));
    if (g.epic) lines.push(`- ${t.epic}: ${g.epic.title}`);
    lines.push(`- ${t.status}: ${t.statusLabel[g.status]}`);
    lines.push(`- ${t.progress}: ${g.progressNote?.trim() || t.todo}`);
    lines.push(`- ${t.actions}:`);
    const acts = [...g.activities].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    if (acts.length === 0) lines.push(`  - ${t.none}`);
    for (const a of acts) lines.push(`  ${activityLine(a, tz)}`);
    if (g.status === "in_progress" || g.status === "partial") lines.push(`- ${t.next}: ${t.todo}`);
    lines.push("");
  });

  lines.push(t.outsideH, "");
  const outside = unlinkedActivities
    .filter((a) => a.isHighlight || a.note || a.source !== "calendar_event")
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  if (outside.length === 0) lines.push(t.none);
  for (const a of outside) lines.push(activityLine(a, tz));
  lines.push("");

  lines.push(t.nextGoalsH, "", `- ${t.todo}`, "");

  lines.push(t.appendixH, "", t.tableHead);
  const all = [...goals.flatMap((g) => g.activities.map((a) => ({ a, goal: g.title }))), ...unlinkedActivities.map((a) => ({ a, goal: "" }))].sort(
    (x, y) => x.a.occurredAt.localeCompare(y.a.occurredAt),
  );
  for (const { a, goal } of all) {
    const title = a.url ? `[${mdText(a.title)}](${mdUrl(a.url)})` : mdText(a.title);
    lines.push(`| ${fmtDate(a.occurredAt, tz)} | ${sourceLabel(a)} | ${title.replace(/\|/g, "\\|")} | ${goal} |`);
  }
  return lines.join("\n").trimEnd() + "\n";
}

export interface PeriodReportInput {
  label: string;
  periodStart: string;
  periodEnd: string;
  sprints: Sprint[];
  goalCounts: Record<GoalStatus, number>;
  epics: Array<{ epic: Epic; goals: Goal[]; activities: Activity[]; sprintsById: Map<number, Sprint> }>;
  highlights: Activity[];
}

export function renderPeriodReport(input: PeriodReportInput, lang: Lang, tz: string): string {
  const t = T[lang];
  const lines: string[] = [];
  lines.push(t.periodTitle(input.label, input.periodStart, input.periodEnd), "");
  lines.push(t.summaryH, "");
  const c = input.goalCounts;
  lines.push(t.sprintsLine(input.sprints.length, c.achieved, c.partial, c.not_started + c.in_progress + c.dropped));
  lines.push(t.oneLine, "");

  lines.push(t.epicsH, "");
  if (input.epics.length === 0) lines.push(t.none, "");
  for (const e of input.epics) {
    lines.push(`### ${e.epic.title} (${e.epic.status})`);
    lines.push(`- ${t.epicProgress}: ${e.epic.progressNote?.trim() || t.todo}`);
    lines.push(`- ${t.relatedGoals}:`);
    if (e.goals.length === 0) lines.push(`  - ${t.none}`);
    for (const g of e.goals) {
      const s = e.sprintsById.get(g.sprintId);
      const period = s ? `${s.startDate}〜${s.endDate}` : "";
      lines.push(`  - ${period} ${g.title} (${t.statusLabel[g.status]})`);
    }
    lines.push(`- ${t.keyActions}:`);
    const key = e.activities.filter((a) => a.isHighlight || a.note).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    if (key.length === 0) lines.push(`  - ${t.none}`);
    for (const a of key) lines.push(`  ${activityLine(a, tz)}`);
    lines.push("");
  }

  lines.push(t.highlightsH, "");
  if (input.highlights.length === 0) lines.push(t.none);
  for (const a of [...input.highlights].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))) lines.push(activityLine(a, tz));
  lines.push("");
  lines.push(t.nextPeriodH, "", `- ${t.todo}`, "");
  return lines.join("\n").trimEnd() + "\n";
}

export function normalizeLang(s: string | undefined): Lang {
  return s === "ja" ? "ja" : "ko";
}
