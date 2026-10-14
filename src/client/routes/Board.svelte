<script lang="ts">
  import { onMount } from "svelte";
  import type { Goal, Sprint, Task, TaskStatus } from "$shared/types";
  import { TASK_STATUSES } from "$shared/types";
  import { api } from "../lib/api";
  import { safeHref, TASK_STATUS_LABEL, ymdShort } from "../lib/format";

  let tasks = $state<Task[]>([]);
  let sprints = $state<Sprint[]>([]);
  let goals = $state<Goal[]>([]);
  let sprintFilter = $state<number | "all" | "none">("all");
  let loading = $state(true);
  let importing = $state(false);
  let msg = $state("");

  // 새 Task
  let newTitle = $state("");
  let newStatus = $state<TaskStatus>("todo");

  // 편집
  let editing = $state<Task | null>(null);
  let eTitle = $state("");
  let eDesc = $state("");
  let eDue = $state("");
  let eSprint = $state<number | "">("");
  let eGoal = $state<number | "">("");
  let eUrl = $state("");
  let ePriority = $state<Task["priority"]>("normal");

  async function load() {
    loading = true;
    try {
      [tasks, sprints] = await Promise.all([api.tasks.list(), api.sprints.list()]);
      const active = sprints.find((s) => s.status === "active");
      if (sprintFilter === "all" && active) sprintFilter = active.id;
      goals = await fetchGoals();
    } finally {
      loading = false;
    }
  }

  async function fetchGoals(): Promise<Goal[]> {
    const res = await fetch("/api/goals", { credentials: "same-origin" });
    return res.ok ? ((await res.json()) as Goal[]) : [];
  }

  onMount(() => {
    load();
    const h = () => load();
    window.addEventListener("mz:synced", h);
    return () => window.removeEventListener("mz:synced", h);
  });

  const visible = $derived(
    tasks.filter((t) => {
      if (sprintFilter === "all") return true;
      if (sprintFilter === "none") return t.sprintId === null;
      return t.sprintId === sprintFilter || (t.status !== "done" && t.sprintId === null && false);
    }),
  );

  const columns = $derived(TASK_STATUSES.map((s) => ({ status: s, cards: visible.filter((t) => t.status === s) })));
  const goalById = $derived(new Map(goals.map((g) => [g.id, g])));
  const currentSprintId = $derived(typeof sprintFilter === "number" ? sprintFilter : null);

  async function addTask() {
    if (!newTitle.trim()) return;
    await api.tasks.create({ title: newTitle.trim(), status: newStatus, sprintId: currentSprintId });
    newTitle = "";
    await load();
  }

  async function move(t: Task, status: TaskStatus) {
    if (t.status === status) return;
    await api.tasks.update(t.id, { status });
    await load();
  }

  async function importGithub() {
    importing = true;
    msg = "";
    try {
      const r = await api.tasks.importGithub(currentSprintId);
      msg = `GitHub에서 ${r.imported}건 가져옴 (할당된 Issue ${r.total}건)`;
      await load();
    } catch (e) {
      msg = e instanceof Error ? e.message : "가져오기 실패";
    } finally {
      importing = false;
      setTimeout(() => (msg = ""), 6000);
    }
  }

  function startEdit(t: Task) {
    editing = t;
    eTitle = t.title;
    eDesc = t.description ?? "";
    eDue = t.dueDate ?? "";
    eSprint = t.sprintId ?? "";
    eGoal = t.goalId ?? "";
    eUrl = t.githubUrl ?? "";
    ePriority = t.priority;
  }

  async function saveEdit() {
    if (!editing) return;
    await api.tasks.update(editing.id, {
      title: eTitle.trim(),
      description: eDesc.trim() || null,
      dueDate: eDue || null,
      sprintId: eSprint === "" ? null : Number(eSprint),
      goalId: eGoal === "" ? null : Number(eGoal),
      githubUrl: eUrl.trim() || null,
      priority: ePriority,
    });
    editing = null;
    await load();
  }

  async function removeTask() {
    if (!editing) return;
    if (!confirm(`"${editing.title}" Task를 삭제합니다.`)) return;
    await api.tasks.remove(editing.id);
    editing = null;
    await load();
  }

  const editGoals = $derived(goals.filter((g) => eSprint === "" || g.sprintId === Number(eSprint)));

  // 드래그 앤 드롭
  let dragId = $state<number | null>(null);
  function onDrop(status: TaskStatus) {
    const t = tasks.find((x) => x.id === dragId);
    dragId = null;
    if (t) move(t, status);
  }
</script>

<div class="page wide">
  <div class="page-head">
    <div class="stack" style="gap:4px">
      <h1>Board</h1>
      <span class="muted">GitHub Issue·PR의 open/closed 상태는 자동으로 반영됩니다. 닫히면 Done으로 이동합니다.</span>
    </div>
    <div class="row">
      <label class="muted" for="sprint-f">스프린트</label>
      <select id="sprint-f" class="select" style="width:auto" bind:value={sprintFilter}>
        <option value="all">전체</option>
        <option value="none">미지정</option>
        {#each sprints as s (s.id)}
          <option value={s.id}>{ymdShort(s.startDate)} – {ymdShort(s.endDate)}{s.status === "active" ? " (현재)" : ""}</option>
        {/each}
      </select>
      <button class="btn" onclick={importGithub} disabled={importing}>{importing ? "가져오는 중…" : "GitHub Issue 가져오기"}</button>
    </div>
  </div>

  {#if msg}<div class="card" style="padding:10px 14px">{msg}</div>{/if}

  <div class="card add">
    <input class="input" bind:value={newTitle} placeholder="새 Task" onkeydown={(e) => e.key === "Enter" && addTask()} />
    <select class="select" style="width:auto" bind:value={newStatus} aria-label="상태">
      {#each TASK_STATUSES as s (s)}<option value={s}>{TASK_STATUS_LABEL[s]}</option>{/each}
    </select>
    <button class="btn primary" onclick={addTask} disabled={!newTitle.trim()}>Task 추가</button>
  </div>

  {#if loading && tasks.length === 0}
    <div class="empty">불러오는 중…</div>
  {:else}
    <div class="board">
      {#each columns as col (col.status)}
        <section
          class="col"
          class:over={dragId !== null}
          ondragover={(e) => e.preventDefault()}
          ondrop={() => onDrop(col.status)}
          aria-label={TASK_STATUS_LABEL[col.status]}
        >
          <div class="col-head">
            <h2>{TASK_STATUS_LABEL[col.status]}</h2>
            <span class="mono muted">{col.cards.length}</span>
          </div>
          {#each col.cards as t (t.id)}
            <article class="task" draggable="true" ondragstart={() => (dragId = t.id)} ondragend={() => (dragId = null)}>
              <button class="task-title" onclick={() => startEdit(t)}>{t.title}</button>
              <div class="meta">
                {#if t.githubUrl}
                  <a class="mono" href={safeHref(t.githubUrl)} target="_blank" rel="noopener">{t.githubUrl.replace(/^https:\/\/github\.com\//, "").replace(/\/(issues|pull)\//, "#")}</a>
                  {#if t.githubState && t.githubState !== "open"}<span class="chip src-github">{t.githubState}</span>{/if}
                {/if}
                {#if t.goalId && goalById.get(t.goalId)}<span class="chip goal">{goalById.get(t.goalId)!.title}</span>{/if}
                {#if t.dueDate}<span class="chip warn">마감 {ymdShort(t.dueDate)}</span>{/if}
                {#if t.priority === "high"}<span class="chip" style="background:#fde8e8;color:#8a1f1f">높음</span>{/if}
              </div>
              <div class="moves">
                {#each TASK_STATUSES.filter((s) => s !== t.status) as s (s)}
                  <button class="mv" onclick={() => move(t, s)}>→ {TASK_STATUS_LABEL[s]}</button>
                {/each}
              </div>
            </article>
          {/each}
        </section>
      {/each}
    </div>
  {/if}
</div>

{#if editing}
  <div class="modal-bg" role="presentation" onclick={() => (editing = null)} onkeydown={(e) => e.key === "Escape" && (editing = null)}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="modal card" role="dialog" aria-modal="true" aria-labelledby="edit-h" tabindex="-1" onclick={(e) => e.stopPropagation()}>
      <h2 id="edit-h">Task 편집</h2>
      <div class="field"><label for="et">제목</label><input id="et" class="input" bind:value={eTitle} /></div>
      <div class="field"><label for="ed">설명</label><textarea id="ed" class="textarea" rows="3" bind:value={eDesc}></textarea></div>
      <div class="grid2">
        <div class="field"><label for="edue">마감</label><input id="edue" type="date" class="input" bind:value={eDue} /></div>
        <div class="field">
          <label for="ep">우선순위</label>
          <select id="ep" class="select" bind:value={ePriority}><option value="low">낮음</option><option value="normal">보통</option><option value="high">높음</option></select>
        </div>
        <div class="field">
          <label for="es">스프린트</label>
          <select id="es" class="select" bind:value={eSprint}>
            <option value="">(미지정)</option>
            {#each sprints as s (s.id)}<option value={s.id}>{ymdShort(s.startDate)} – {ymdShort(s.endDate)}</option>{/each}
          </select>
        </div>
        <div class="field">
          <label for="eg">목표</label>
          <select id="eg" class="select" bind:value={eGoal}>
            <option value="">(없음)</option>
            {#each editGoals as g (g.id)}<option value={g.id}>{g.title}</option>{/each}
          </select>
        </div>
      </div>
      <div class="field"><label for="eu">GitHub Issue/PR URL</label><input id="eu" class="input" bind:value={eUrl} placeholder="https://github.com/owner/repo/issues/123" /></div>
      <div class="row" style="justify-content:space-between">
        <button class="btn" style="color:#8a1f1f" onclick={removeTask}>삭제</button>
        <div class="row">
          <button class="btn" onclick={() => (editing = null)}>취소</button>
          <button class="btn primary" onclick={saveEdit} disabled={!eTitle.trim()}>저장</button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .page.wide {
    max-width: 1320px;
  }
  .add {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 8px;
    padding: 12px;
  }
  @media (max-width: 560px) {
    .add {
      grid-template-columns: 1fr;
    }
  }
  .board {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    align-items: flex-start;
  }
  .col {
    flex: 1 1 240px;
    min-width: 0;
    background: var(--surface-muted);
    border-radius: 12px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 120px;
  }
  .col-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px 6px;
  }
  .col-head h2 {
    font-size: 14px;
  }
  .task {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    cursor: grab;
  }
  .task-title {
    all: unset;
    cursor: pointer;
    font-size: 14px;
    line-height: 1.45;
  }
  .task-title:hover {
    text-decoration: underline;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    font-size: 12px;
  }
  .meta a {
    color: var(--purple);
    text-decoration: none;
  }
  .moves {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .mv {
    border: none;
    background: transparent;
    color: var(--text-3);
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 6px;
    cursor: pointer;
  }
  .mv:hover {
    background: var(--surface-muted);
    color: var(--text);
  }
  .modal-bg {
    position: fixed;
    inset: 0;
    background: rgba(24, 33, 30, 0.4);
    display: grid;
    place-items: center;
    padding: 16px;
    z-index: 20;
  }
  .modal {
    width: min(560px, 100%);
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-height: 90vh;
    overflow: auto;
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  @media (max-width: 480px) {
    .grid2 {
      grid-template-columns: 1fr;
    }
  }
</style>
