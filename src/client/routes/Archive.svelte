<script lang="ts">
  import type { PeriodSummary } from "$shared/types";
  import { api, ApiError, type PeriodOption } from "../lib/api";
  import { EPIC_STATUS_LABEL, GOAL_STATUS_LABEL, md, relTime, safeHref, ymdShort } from "../lib/format";
  import { router } from "../lib/router.svelte";

  let { period }: { period?: string } = $props();

  let options = $state<PeriodOption[]>([]);
  let currentKey = $state("");
  let summary = $state<PeriodSummary | null>(null);
  let loading = $state(true);
  let error = $state("");
  let generating = $state(false);

  async function load() {
    loading = true;
    error = "";
    try {
      const p = await api.periods.list();
      options = p.periods;
      currentKey = period ?? p.current.quarter.key;
      summary = await api.periods.get(currentKey);
    } catch (e) {
      error = e instanceof ApiError ? e.message : "불러오지 못했습니다";
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void period;
    load();
  });

  async function generate() {
    generating = true;
    try {
      const r = await api.reports.draftPeriod(currentKey);
      router.go({ name: "report", id: r.id });
    } catch (e) {
      error = e instanceof ApiError ? e.message : "생성 실패";
    } finally {
      generating = false;
    }
  }

  const total = $derived(summary ? Object.values(summary.goalCounts).reduce((a, b) => a + b, 0) : 0);
  const periodReport = $derived(summary?.reports.find((r) => r.kind !== "sprint" && r.periodStart === summary?.periodStart) ?? null);
</script>

<div class="page">
  <div class="page-head">
    <div class="stack" style="gap:4px">
      <h1>Archive</h1>
      <span class="muted">분기·반기 단위로 성과를 돌아봅니다. 회계연도는 10월 시작입니다.</span>
    </div>
    <div class="row">
      <select class="select" style="width:auto" value={currentKey} onchange={(e) => router.go({ name: "archive", period: e.currentTarget.value })} aria-label="기간">
        {#each options as o (o.key)}
          <option value={o.key}>{o.label} ({ymdShort(o.periodStart)} – {ymdShort(o.periodEnd)})</option>
        {/each}
      </select>
      {#if periodReport}
        <a class="btn" href="/report/{periodReport.id}" use:router.link>기간 리포트 열기</a>
      {:else}
        <button class="btn outline" onclick={generate} disabled={generating}>기간 리포트 초안 생성</button>
      {/if}
    </div>
  </div>

  {#if error}<div class="error">{error}</div>{/if}

  {#if loading && !summary}
    <div class="empty">불러오는 중…</div>
  {:else if summary}
    <div class="kpis">
      <div class="card kpi"><span class="muted">스프린트</span><strong>{summary.sprints.length}</strong></div>
      <div class="card kpi"><span class="muted">목표 달성</span><strong>{summary.goalCounts.achieved}<small>/{total}</small></strong></div>
      <div class="card kpi"><span class="muted">부분달성</span><strong>{summary.goalCounts.partial}</strong></div>
      <div class="card kpi"><span class="muted">하이라이트</span><strong>{summary.highlights.length}</strong></div>
    </div>

    <section class="card sec">
      <h2>Epic별 진척</h2>
      {#if summary.epics.length === 0}
        <div class="empty">이 기간에 연결된 Epic이 없습니다.</div>
      {:else}
        {#each summary.epics as e (e.epic.id)}
          <article class="epic">
            <div class="row" style="justify-content:space-between">
              <a href="/epics/{e.epic.id}" use:router.link><h3>{e.epic.title}</h3></a>
              <span class="pill status-{e.epic.status === 'done' ? 'achieved' : e.epic.status === 'paused' ? 'not_started' : 'in_progress'}">{EPIC_STATUS_LABEL[e.epic.status]}</span>
            </div>
            {#if e.epic.progressNote}<p class="muted">{e.epic.progressNote}</p>{/if}
            <ul class="goals">
              {#each e.goals as g (g.id)}
                {@const s = summary.sprints.find((x) => x.id === g.sprintId)}
                <li>
                  <span class="mono muted">{s ? `${ymdShort(s.startDate)}–${ymdShort(s.endDate)}` : ""}</span>
                  <span>{g.title}</span>
                  <span class="pill status-{g.status}">{GOAL_STATUS_LABEL[g.status]}</span>
                </li>
              {/each}
            </ul>
            <span class="muted small">관련 활동 {e.activities.length}건</span>
          </article>
        {/each}
      {/if}
    </section>

    <div class="cols">
      <section class="card sec" style="flex:1 1 320px">
        <h2>스프린트 리포트</h2>
        {#if summary.sprints.length === 0}
          <div class="empty">기간 내 종료된 스프린트가 없습니다.</div>
        {:else}
          <ul class="plain">
            {#each summary.sprints as s (s.id)}
              {@const r = summary.reports.find((x) => x.kind === "sprint" && x.sprintId === s.id)}
              <li class="row" style="justify-content:space-between">
                <a href={r ? `/report/${r.id}` : `/report?sprint=${s.id}`} use:router.link>{ymdShort(s.startDate)} – {ymdShort(s.endDate)}</a>
                <span class="muted small">{r ? (r.finalizedAt ? "확정" : "초안") : "리포트 없음"}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
      <section class="card sec" style="flex:1 1 320px">
        <h2>목표 이외의 하이라이트</h2>
        {#if summary.highlights.length === 0}
          <div class="empty">하이라이트로 표시한 활동이 없습니다.</div>
        {:else}
          <ul class="plain">
            {#each summary.highlights as a (a.id)}
              <li class="row">
                <span class="mono muted">{md(a.occurredAt)}</span>
                {#if a.url}<a href={safeHref(a.url)} target="_blank" rel="noopener">{a.title}</a>{:else}<span>{a.title}</span>{/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    </div>
    {#if periodReport}
      <span class="muted small">기간 리포트 {periodReport.finalizedAt ? "확정" : "초안"} · {relTime(periodReport.updatedAt)}</span>
    {/if}
  {/if}
</div>

<style>
  .kpis {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 12px;
  }
  .kpi {
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .kpi strong {
    font-size: 26px;
    font-weight: 700;
  }
  .kpi small {
    font-size: 14px;
    color: var(--text-3);
    font-weight: 400;
  }
  .sec {
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .epic {
    padding: 14px 16px;
    border: 1px solid var(--border-soft);
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .epic a {
    text-decoration: none;
    color: inherit;
  }
  .epic p {
    margin: 0;
    font-size: 13px;
  }
  .goals,
  .plain {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .goals li {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 10px;
    align-items: center;
    font-size: 13px;
  }
  .cols {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
  }
  .small {
    font-size: 12px;
  }
</style>
