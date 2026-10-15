<script lang="ts">
  import type { Activity, Goal } from "$shared/types";
  import { api } from "../lib/api";
  import { md, safeHref, sourceGroup, sourceLabel } from "../lib/format";
  import { isSubmitEnter } from "../lib/keys";

  let {
    activity,
    goals = [],
    showGoal = true,
    onchange,
  }: {
    activity: Activity;
    goals?: Pick<Goal, "id" | "title">[];
    showGoal?: boolean;
    onchange?: (a: Activity) => void;
  } = $props();

  let editingNote = $state(false);
  let noteDraft = $state("");
  let busy = $state(false);

  async function update(patch: Parameters<typeof api.activities.update>[1]) {
    busy = true;
    try {
      const updated = await api.activities.update(activity.id, patch);
      onchange?.(updated);
    } finally {
      busy = false;
    }
  }

  function startNote() {
    noteDraft = activity.note ?? "";
    editingNote = true;
  }

  async function saveNote() {
    await update({ note: noteDraft.trim() || null });
    editingNote = false;
  }

  const goalLabel = $derived(goals.find((g) => g.id === activity.goalId)?.title ?? null);
  // Board 의 Task 에 연결된 활동은 목표를 Task 에서 물려받으므로 읽기 전용으로 보여 준다.
  const taskLinked = $derived(activity.taskId !== null);
</script>

<li class="act" class:busy>
  <span class="date mono">{md(activity.occurredAt)}</span>
  <span class="chip src-{sourceGroup(activity)}">{sourceLabel(activity)}</span>
  <span class="title">
    {#if activity.url}
      <a href={safeHref(activity.url)} target="_blank" rel="noopener">{activity.title}</a>
    {:else}
      {activity.title}
    {/if}
    {#if activity.note && !editingNote}
      <span class="note">— {activity.note}</span>
    {/if}
  </span>
  <button
    class="star"
    class:on={activity.isHighlight}
    title={activity.isHighlight ? "하이라이트 해제" : "하이라이트"}
    aria-pressed={activity.isHighlight}
    onclick={() => update({ isHighlight: !activity.isHighlight })}
    disabled={busy}
  >
    <svg width="16" height="16" viewBox="0 0 24 24" fill={activity.isHighlight ? "var(--star)" : "none"} stroke="var(--star)" stroke-width="1.6" aria-hidden="true">
      <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
    </svg>
  </button>
  <button class="btn sm" onclick={startNote} disabled={busy}>메모</button>
  {#if showGoal}
    {#if taskLinked}
      <span class="chip goal" class:none={!goalLabel} title="Board 의 Task 목표를 따릅니다. 바꾸려면 Board 에서 수정하세요.">{goalLabel ?? "목표 없음"}</span>
    {:else if goals.length}
      <select
        class="select goal-select"
        class:linked={!!activity.goalId}
        value={activity.goalId ?? ""}
        onchange={(e) => update({ goalId: e.currentTarget.value ? Number(e.currentTarget.value) : null })}
        disabled={busy}
        aria-label="연결할 목표"
      >
        <option value="">목표 외</option>
        {#each goals as g (g.id)}
          <option value={g.id}>{g.title}</option>
        {/each}
      </select>
    {:else if goalLabel}
      <span class="chip goal">{goalLabel}</span>
    {/if}
  {/if}
  {#if editingNote}
    <div class="note-edit">
      <input class="input" bind:value={noteDraft} placeholder="리포트에 우선 반영되는 메모" onkeydown={(e) => isSubmitEnter(e) && saveNote()} />
      <button class="btn sm primary" onclick={saveNote} disabled={busy}>저장</button>
      <button class="btn sm" onclick={() => (editingNote = false)}>취소</button>
    </div>
  {/if}
</li>

<style>
  .act {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
    padding: 12px 18px;
    border-top: 1px solid var(--border-soft);
    list-style: none;
  }
  .act.busy {
    opacity: 0.6;
  }
  .date {
    width: 44px;
    font-size: 13px;
    color: var(--text-3);
  }
  .title {
    flex: 1 1 220px;
    min-width: 0;
    line-height: 1.5;
  }
  .title a {
    color: inherit;
    text-decoration: none;
  }
  .title a:hover {
    text-decoration: underline;
  }
  .note {
    color: var(--text-2);
  }
  .star {
    border: none;
    background: transparent;
    padding: 4px;
    cursor: pointer;
    line-height: 0;
    opacity: 0.45;
  }
  .star.on,
  .star:hover {
    opacity: 1;
  }
  .goal-select {
    width: auto;
    min-height: 32px;
    padding: 4px 8px;
    font-size: 12px;
    border-style: dashed;
    border-color: var(--warn-border);
    color: var(--warn);
    font-weight: 600;
  }
  .goal-select.linked {
    border-style: solid;
    border-color: var(--accent-tint);
    background: var(--accent-tint);
    color: var(--accent-strong);
  }
  .chip.goal.none {
    color: var(--text-3);
    border-style: dashed;
  }
  .note-edit {
    flex: 1 1 100%;
    display: flex;
    gap: 8px;
  }
</style>
