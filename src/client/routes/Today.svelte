<script lang="ts">
  import { onMount } from "svelte";
  import { api, type TodayData } from "../lib/api";
  import { hm, md, ymdShort } from "../lib/format";
  import { router } from "../lib/router.svelte";

  let data = $state<TodayData | null>(null);
  let error = $state("");

  async function load() {
    try {
      data = await api.today();
    } catch (e) {
      error = e instanceof Error ? e.message : "불러오지 못했습니다";
    }
  }

  onMount(() => {
    load();
    const h = () => load();
    window.addEventListener("mz:synced", h);
    return () => window.removeEventListener("mz:synced", h);
  });

  const dateLabel = $derived.by(() => {
    if (!data) return "";
    const d = new Date(`${data.today}T00:00:00`);
    return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long" }).format(d);
  });

  async function markDone(id: number) {
    await api.tasks.update(id, { status: "done" });
    await load();
  }
</script>

<div class="page narrow">
  <div class="stack" style="gap:2px">
    <span class="muted">{dateLabel}</span>
    <h1>Today</h1>
  </div>

  {#if error}<div class="error">{error}</div>{/if}

  {#if data}
    {#if data.sprint}
      <a class="hero" href="/sprint/{data.sprint.id}" use:router.link>
        <span class="hero-sub">스프린트 {ymdShort(data.sprint.startDate)} – {ymdShort(data.sprint.endDate)}{data.sprint.meetingDate ? ` · 미팅 ${ymdShort(data.sprint.meetingDate)}` : ""}</span>
        {#if data.goalSummary}
          <strong>목표 {data.goalSummary.total}개 중 {data.goalSummary.achieved}개 달성 · {data.goalSummary.inProgress}개 진행중</strong>
        {/if}
        <span class="hero-link">스프린트 보기</span>
      </a>
    {:else}
      <a class="hero" href="/sprint" use:router.link>
        <strong>진행 중인 스프린트가 없습니다</strong>
        <span class="hero-link">스프린트 만들기</span>
      </a>
    {/if}

    <section class="stack" style="gap:8px">
      <h2>오늘 일정</h2>
      <div class="card">
        {#if data.events.length === 0}
          <div class="empty">수집된 일정이 없습니다. 동기화 후 표시됩니다.</div>
        {:else}
          {#each data.events as e (e.id)}
            <div class="line">
              <span class="mono muted w">{hm(e.occurredAt)}</span>
              <span>{e.title.replace(/^미팅 · /, "")}</span>
            </div>
          {/each}
        {/if}
      </div>
    </section>

    <section class="stack" style="gap:8px">
      <div class="row" style="justify-content:space-between">
        <h2>진행 중 Task</h2>
        <a href="/board" use:router.link class="muted small">Board</a>
      </div>
      <div class="card">
        {#if data.tasks.length === 0}
          <div class="empty">Todo / In Progress 상태의 Task가 없습니다.</div>
        {:else}
          {#each data.tasks as t (t.id)}
            <div class="line col">
              <div class="row" style="justify-content:space-between;flex-wrap:nowrap">
                <span>{t.title}</span>
                <button class="btn sm" onclick={() => markDone(t.id)}>완료</button>
              </div>
              <div class="row small">
                <span class="chip {t.status === 'in_progress' ? 'goal' : 'src-manual'}">{t.status === "in_progress" ? "진행중" : "Todo"}</span>
                {#if t.githubUrl}<a class="mono" style="color:var(--purple)" href={t.githubUrl} target="_blank" rel="noopener">#{t.githubUrl.split("/").pop()}</a>{/if}
                {#if t.dueDate}<span class="chip warn">마감 {ymdShort(t.dueDate)}</span>{/if}
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </section>

    <section class="stack" style="gap:8px">
      <h2>최근 완료한 TODO</h2>
      <div class="card">
        {#if data.recentTodos.length === 0}
          <div class="empty">최근 7일간 완료한 Google TODO가 없습니다.</div>
        {:else}
          {#each data.recentTodos as a (a.id)}
            <div class="line">
              <span class="mono muted w">{md(a.occurredAt)}</span>
              <span class="done">{a.title.replace(/^TODO 완료 · /, "")}</span>
            </div>
          {/each}
        {/if}
      </div>
    </section>
  {/if}
</div>

<style>
  .page.narrow {
    max-width: 720px;
  }
  .hero {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 18px;
    border-radius: 12px;
    background: var(--accent);
    color: #fff;
    text-decoration: none;
  }
  .hero-sub {
    font-size: 13px;
    opacity: 0.9;
  }
  .hero strong {
    font-size: 17px;
  }
  .hero-link {
    font-size: 13px;
    text-decoration: underline;
  }
  .line {
    display: flex;
    gap: 14px;
    padding: 12px 14px;
    border-top: 1px solid var(--border-soft);
  }
  .line:first-child {
    border-top: none;
  }
  .line.col {
    flex-direction: column;
    gap: 6px;
  }
  .w {
    width: 44px;
    flex: none;
    font-size: 13px;
  }
  .small {
    font-size: 12px;
  }
  .done {
    color: var(--text-3);
    text-decoration: line-through;
  }
</style>
