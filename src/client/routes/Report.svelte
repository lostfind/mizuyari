<script lang="ts">
  import type { Report, Sprint } from "$shared/types";
  import { api, ApiError } from "../lib/api";
  import { relTime, renderMarkdown, ymdShort } from "../lib/format";
  import { router } from "../lib/router.svelte";

  let { id }: { id?: number } = $props();

  let report = $state<Report | null>(null);
  let sprints = $state<Sprint[]>([]);
  let reports = $state<Omit<Report, "markdown">[]>([]);
  let selectedSprint = $state<number | "">("");
  let lang = $state<"ko" | "ja">("ko");
  let markdown = $state("");
  let dirty = $state(false);
  let busy = $state(false);
  let msg = $state("");
  let error = $state("");

  async function load() {
    error = "";
    try {
      [sprints, reports] = await Promise.all([api.sprints.list(), api.reports.list()]);
      const cfg = await api.config();
      lang = cfg.reportLang === "ja" ? "ja" : "ko";
      const sprintParam = new URLSearchParams(location.search).get("sprint");
      if (id) {
        report = await api.reports.get(id);
        markdown = report.markdown;
        selectedSprint = report.sprintId ?? "";
      } else {
        const sid = sprintParam ? Number(sprintParam) : (sprints.find((s) => s.status === "active")?.id ?? "");
        selectedSprint = sid;
        const existing = reports.find((r) => r.kind === "sprint" && r.sprintId === sid);
        if (existing) {
          report = await api.reports.get(existing.id);
          markdown = report.markdown;
        } else {
          report = null;
          markdown = "";
        }
      }
      dirty = false;
    } catch (e) {
      error = e instanceof ApiError ? e.message : "불러오지 못했습니다";
    }
  }

  $effect(() => {
    void id;
    load();
  });

  async function generate() {
    if (selectedSprint === "") return;
    if (dirty && !confirm("편집 중인 내용을 버리고 다시 생성합니다. 이전 내용은 버전 이력에 남습니다.")) return;
    busy = true;
    msg = "";
    try {
      report = await api.reports.draftSprint(Number(selectedSprint), lang);
      markdown = report.markdown;
      dirty = false;
      msg = "초안을 생성했습니다";
      reports = await api.reports.list();
    } catch (e) {
      msg = e instanceof ApiError ? e.message : "생성 실패";
    } finally {
      busy = false;
    }
  }

  async function save() {
    if (!report) return;
    busy = true;
    try {
      report = await api.reports.update(report.id, { markdown });
      dirty = false;
      msg = `저장됨 ${relTime(report.updatedAt)}`;
    } catch (e) {
      msg = e instanceof ApiError ? e.message : "저장 실패";
    } finally {
      busy = false;
    }
  }

  async function finalize() {
    if (!report) return;
    if (dirty) await save();
    busy = true;
    try {
      report = await api.reports.finalize(report.id);
      msg = "확정했습니다";
      reports = await api.reports.list();
    } finally {
      busy = false;
    }
  }

  async function unfinalize() {
    if (!report) return;
    busy = true;
    try {
      report = await api.reports.unfinalize(report.id);
      msg = "확정을 해제했습니다";
      reports = await api.reports.list();
    } finally {
      busy = false;
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(markdown);
    msg = "클립보드에 복사했습니다";
  }

  function onSprintChange(v: string) {
    router.go(`/report?sprint=${v}`, true);
    id = undefined;
    load();
  }

  const html = $derived(renderMarkdown(markdown));
  const finalized = $derived(!!report?.finalizedAt);
  const sprintLabel = $derived.by(() => {
    const s = sprints.find((x) => x.id === Number(selectedSprint));
    return s ? `${ymdShort(s.startDate)} – ${ymdShort(s.endDate)}` : "";
  });
</script>

<div class="page wide">
  <div class="page-head">
    <div class="stack" style="gap:4px">
      <h1>{report?.kind === "quarter" || report?.kind === "half_year" ? `${report.title} 성과 리포트` : "컨디셔닝 미팅 리포트"}</h1>
      <span class="muted">
        {#if report}
          {report.kind === "sprint" ? sprintLabel : `${report.periodStart} – ${report.periodEnd}`} · {finalized ? `확정 ${relTime(report.finalizedAt)}` : `초안 · 수정 ${relTime(report.updatedAt)}`}
        {:else}
          {sprintLabel} · 아직 초안이 없습니다
        {/if}
      </span>
    </div>
    <div class="row">
      {#if !report || report.kind === "sprint"}
        <select class="select" style="width:auto" value={selectedSprint} onchange={(e) => onSprintChange(e.currentTarget.value)} aria-label="스프린트">
          {#each sprints as s (s.id)}
            <option value={s.id}>{ymdShort(s.startDate)} – {ymdShort(s.endDate)}</option>
          {/each}
        </select>
        <select class="select" style="width:auto" bind:value={lang} aria-label="출력 언어">
          <option value="ko">한국어</option>
          <option value="ja">日本語</option>
        </select>
        <button class="btn outline" onclick={generate} disabled={busy || finalized || selectedSprint === ""}>
          {report ? "다시 생성" : "초안 생성"}
        </button>
      {/if}
      <button class="btn" onclick={copy} disabled={!markdown}>마크다운 복사</button>
      {#if report && !finalized}
        <button class="btn" onclick={save} disabled={busy || !dirty}>저장</button>
        <button class="btn primary" onclick={finalize} disabled={busy}>확정</button>
      {:else if report}
        <button class="btn" onclick={unfinalize} disabled={busy}>확정 해제</button>
      {/if}
    </div>
  </div>

  {#if error}<div class="error">{error}</div>{/if}
  {#if msg}<div class="muted" style="font-size:13px">{msg}</div>{/if}

  {#if !report && !error}
    <div class="card empty-state">
      <p>목표·활동·메모를 바탕으로 템플릿 초안을 만듭니다. 생성 후 자유롭게 편집할 수 있고, 다시 생성하면 이전 내용은 버전 이력에 남습니다.</p>
      <button class="btn primary" onclick={generate} disabled={busy || selectedSprint === ""}>초안 생성</button>
    </div>
  {:else if report}
    <div class="cols">
      <section class="card editor">
        <label for="md" class="sec-label">마크다운 편집{finalized ? " (확정됨 · 읽기 전용)" : ""}</label>
        <textarea
          id="md"
          class="textarea mono"
          bind:value={markdown}
          oninput={() => (dirty = true)}
          readonly={finalized}
          spellcheck="false"
        ></textarea>
      </section>
      <section class="card preview" aria-label="미리보기">
        <span class="sec-label">미리보기</span>
        <div class="markdown">{@html html}</div>
      </section>
    </div>
  {/if}

  {#if reports.length}
    <section class="card history">
      <h2>리포트 목록</h2>
      <ul>
        {#each reports as r (r.id)}
          <li>
            <a href="/report/{r.id}" use:router.link class:current={r.id === report?.id}>
              {r.kind === "sprint" ? r.title : `${r.title} (${r.kind === "quarter" ? "분기" : "반기"})`}
            </a>
            <span class="muted">{r.finalizedAt ? "확정" : "초안"} · {relTime(r.updatedAt)}</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>

<style>
  .page.wide {
    max-width: 1320px;
  }
  .empty-state {
    padding: 28px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }
  .empty-state p {
    margin: 0;
    color: var(--text-2);
  }
  .cols {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    align-items: stretch;
  }
  .editor,
  .preview {
    flex: 1 1 420px;
    min-width: 0;
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .preview {
    padding: 24px 28px;
  }
  .sec-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-3);
    letter-spacing: 0.04em;
  }
  .editor .textarea {
    flex: 1 1 auto;
    min-height: 640px;
    font-size: 13px;
    line-height: 1.7;
    background: #fafbfa;
  }
  .history {
    padding: 18px;
  }
  .history ul {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .history li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 13px;
  }
  .history a.current {
    font-weight: 600;
  }
</style>
