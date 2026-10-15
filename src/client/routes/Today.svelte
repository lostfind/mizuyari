<script lang="ts">
  import { onMount } from "svelte";
  import { api, type TodayData } from "../lib/api";
  import { githubRef, hm, md, safeHref, ymdShort } from "../lib/format";
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

  const responseLabel: Record<string, string> = { accepted: "참석", tentative: "미정", needsAction: "미응답" };

  function eventColor(e: TodayData["events"][number]): string | null {
    const c = e.metadata?.color;
    return typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c : null;
  }

  function eventLabel(e: TodayData["events"][number]): string | null {
    const id = e.metadata?.colorId;
    return typeof id === "string" ? (data?.calendarLabels[id] ?? null) : null;
  }

  const dateLabel = $derived.by(() => {
    if (!data) return "";
    const d = new Date(`${data.today}T00:00:00`);
    return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long" }).format(d);
  });

  async function markDone(id: number) {
    await api.tasks.update(id, { status: "done" });
    await load();
  }

  // 처리 중인 항목. 미완료 TODO 는 "todo:<id>", 완료 활동은 "done:<activityId>".
  let busyKeys = $state<Set<string>>(new Set());
  let todoError = $state("");

  async function withBusy(key: string, fn: () => Promise<unknown>, failMsg: string) {
    busyKeys = new Set([...busyKeys, key]);
    todoError = "";
    try {
      await fn();
      await load();
    } catch (e) {
      todoError = e instanceof Error ? e.message : failMsg;
    } finally {
      const next = new Set(busyKeys);
      next.delete(key);
      busyKeys = next;
    }
  }

  const completeTodo = (id: number) => withBusy(`todo:${id}`, () => api.todos.complete(id), "완료 처리 실패");
  const reopenTodo = (activityId: number) => withBusy(`done:${activityId}`, () => api.todos.reopen(activityId), "완료 취소 실패");

  function dueLabel(due: string | null): string {
    if (!due) return "";
    const d = due.slice(0, 10);
    if (!data) return ymdShort(d);
    if (d < data.today) return `${ymdShort(d)} 지남`;
    if (d === data.today) return "오늘";
    return ymdShort(d);
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
            {@const color = eventColor(e)}
            {@const label = eventLabel(e)}
            {@const response = typeof e.metadata?.response === "string" ? e.metadata.response : null}
            <div class="line">
              <span class="mono muted w">{hm(e.occurredAt)}</span>
              <span class="dot" style:background={color ?? "transparent"} aria-hidden="true"></span>
              <span class="ev-title">{e.title}</span>
              {#if label}<span class="chip src-manual">{label}</span>{/if}
              {#if response && responseLabel[response]}
                <span class="chip resp-{response}">{responseLabel[response]}</span>
              {/if}
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
                {#if t.githubUrl}
                  {@const gh = githubRef(t.githubUrl)}
                  {#if gh.kind}<span class="chip gh-{gh.kind}">{gh.kind === "pr" ? "PR" : "Issue"}</span>{/if}
                  <a class="mono" style="color:var(--purple)" href={safeHref(t.githubUrl)} target="_blank" rel="noopener">#{t.githubUrl.split("/").pop()}</a>
                {/if}
                {#if t.dueDate}<span class="chip warn">마감 {ymdShort(t.dueDate)}</span>{/if}
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </section>

    <section class="stack" style="gap:8px">
      <h2>Google TODO</h2>
      {#if todoError}<div class="error">{todoError}</div>{/if}
      <div class="card">
        {#if data.openTodos.length === 0 && data.recentTodos.length === 0}
          <div class="empty">Google TODO가 없습니다. 동기화 후 표시됩니다.</div>
        {/if}
        {#each data.openTodos as t (t.id)}
          {@const busy = busyKeys.has(`todo:${t.id}`)}
          <div class="line todo" class:busy>
            <input
              id="todo-{t.id}"
              type="checkbox"
              checked={false}
              disabled={busy}
              onchange={() => completeTodo(t.id)}
              aria-label="{t.title} 완료"
            />
            <label for="todo-{t.id}" class="todo-body">
              <span>{t.title}</span>
              <span class="row small muted">
                <span>{t.listTitle}</span>
                {#if t.due}<span class="chip warn">마감 {dueLabel(t.due)}</span>{/if}
              </span>
            </label>
          </div>
        {/each}
        {#each data.recentTodos as a (a.id)}
          {@const busy = busyKeys.has(`done:${a.id}`)}
          {@const title = a.title}
          <div class="line todo" class:busy>
            <input
              id="done-{a.id}"
              type="checkbox"
              checked={true}
              disabled={busy}
              onchange={() => reopenTodo(a.id)}
              aria-label="{title} 완료 취소"
              title="체크를 해제하면 Google TODO 에서도 미완료로 돌아갑니다"
            />
            <label for="done-{a.id}" class="todo-body">
              <span class="done">{title}</span>
              <span class="small muted">{md(a.occurredAt)} 완료</span>
            </label>
          </div>
        {/each}
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
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex: none;
    align-self: center;
  }
  .ev-title {
    flex: 1;
    min-width: 0;
  }
  .resp-accepted {
    background: var(--green-tint);
    color: var(--green);
  }
  .resp-tentative {
    background: var(--warn-tint);
    color: var(--warn);
  }
  .resp-needsAction {
    background: var(--gray-tint);
    color: var(--text-2);
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
  .todo {
    align-items: flex-start;
    gap: 12px;
  }
  .todo.busy {
    opacity: 0.5;
  }
  .todo input[type="checkbox"] {
    width: 20px;
    height: 20px;
    margin: 2px 0 0;
    flex: none;
    accent-color: var(--accent);
    cursor: pointer;
  }
  .todo input[type="checkbox"]:disabled {
    cursor: default;
  }
  .todo-body {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    cursor: pointer;
  }
</style>
