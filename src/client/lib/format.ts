import type { Activity, GoalStatus, TaskStatus } from "$shared/types";

export const GOAL_STATUS_LABEL: Record<GoalStatus, string> = {
  not_started: "미착수",
  in_progress: "진행중",
  achieved: "달성",
  partial: "부분달성",
  dropped: "중단",
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  done: "Done",
};

export const EPIC_STATUS_LABEL = { active: "진행중", paused: "보류", done: "완료" } as const;

export function sourceGroup(a: Pick<Activity, "source">): "github" | "google" | "task" | "manual" {
  if (a.source.startsWith("github")) return "github";
  if (a.source === "google_task" || a.source === "calendar_event") return "google";
  if (a.source === "task_status") return "task";
  return "manual";
}

export function sourceLabel(a: Pick<Activity, "source" | "metadata">): string {
  switch (a.source) {
    case "github_issue":
      return "Issue";
    case "github_pr":
      return a.metadata?.merged ? "PR merged" : "PR";
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

export function md(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

export function hm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function ymdShort(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${m}/${d}`;
}

export function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function relTime(iso: string | null): string {
  if (!iso) return "없음";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.round(h / 24)}일 전`;
}

/** http(s) URL 만 링크로 쓴다. javascript: 같은 스킴은 null. */
export function safeHref(url: string | null | undefined): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

/** 아주 작은 마크다운 렌더러 (제목, 목록, 링크, 굵게, 표). 리포트 미리보기용.
 *  리포트에는 캘린더 일정·PR 제목처럼 외부인이 정한 문자열이 들어가므로 출력은 반드시 이스케이프하고
 *  링크는 http(s) 만 허용한다. `\[` `\]` `\\` 는 리터럴 문자로 취급한다. */
export function renderMarkdown(src: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const inline = (s: string) =>
    esc(s)
      .replace(/(?<!\\)\[((?:\\.|[^\]\\])+)\]\(([^)\s]+)\)/g, (_m, t, u) =>
        safeHref(u) ? `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>` : t,
      )
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\\([[\]\\])/g, "$1");

  const lines = src.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\|/.test(line)) {
      const rows: string[] = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r: string) => r.replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());
      const body = rows.filter((r) => !/^\|\s*-+/.test(r));
      const [head, ...rest] = body;
      out.push("<table><thead><tr>" + cells(head).map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>");
      for (const r of rest) out.push("<tr>" + cells(r).map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>");
      out.push("</tbody></table>");
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      i++;
      continue;
    }
    if (/^\s*-\s+/.test(line)) {
      out.push("<ul>");
      const stack: number[] = [];
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        const m = /^(\s*)-\s+(.*)$/.exec(lines[i])!;
        const depth = Math.floor(m[1].length / 2);
        while (stack.length < depth) {
          out.push("<ul>");
          stack.push(1);
        }
        while (stack.length > depth) {
          out.push("</ul>");
          stack.pop();
        }
        out.push(`<li>${inline(m[2])}</li>`);
        i++;
      }
      while (stack.length) {
        out.push("</ul>");
        stack.pop();
      }
      out.push("</ul>");
      continue;
    }
    if (line.trim() === "") {
      i++;
      continue;
    }
    out.push(`<p>${inline(line)}</p>`);
    i++;
  }
  return out.join("\n");
}
