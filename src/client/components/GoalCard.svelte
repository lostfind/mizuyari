<script lang="ts">
  import type { Epic, GoalStatus, GoalWithActivities } from "$shared/types";
  import { GOAL_STATUSES } from "$shared/types";
  import { api } from "../lib/api";
  import { GOAL_STATUS_LABEL } from "../lib/format";

  let {
    goal,
    epics,
    onchange,
    ondelete,
  }: {
    goal: GoalWithActivities;
    epics: Epic[];
    onchange: () => void;
    ondelete: () => void;
  } = $props();

  let editing = $state(false);
  let title = $state("");
  let description = $state("");
  let successCriteria = $state("");
  let progressNote = $state("");
  let epicId = $state<number | "">("");
  let busy = $state(false);

  function startEdit() {
    title = goal.title;
    description = goal.description ?? "";
    successCriteria = goal.successCriteria ?? "";
    progressNote = goal.progressNote ?? "";
    epicId = goal.epicId ?? "";
    editing = true;
  }

  async function save() {
    busy = true;
    try {
      await api.goals.update(goal.id, {
        title: title.trim(),
        description: description.trim() || null,
        successCriteria: successCriteria.trim() || null,
        progressNote: progressNote.trim() || null,
        epicId: epicId === "" ? null : Number(epicId),
      });
      editing = false;
      onchange();
    } finally {
      busy = false;
    }
  }

  async function setStatus(status: GoalStatus) {
    busy = true;
    try {
      await api.goals.update(goal.id, { status });
      onchange();
    } finally {
      busy = false;
    }
  }

  async function remove() {
    if (!confirm(`목표 "${goal.title}"을(를) 삭제합니다. 연결된 활동은 목표 외로 돌아갑니다.`)) return;
    await api.goals.remove(goal.id);
    ondelete();
  }
</script>

<article class="goal" class:busy>
  {#if editing}
    <div class="stack">
      <div class="field"><label for="g-title-{goal.id}">제목</label><input id="g-title-{goal.id}" class="input" bind:value={title} /></div>
      <div class="field">
        <label for="g-epic-{goal.id}">Epic</label>
        <select id="g-epic-{goal.id}" class="select" bind:value={epicId}>
          <option value="">(없음)</option>
          {#each epics as e (e.id)}<option value={e.id}>{e.title}</option>{/each}
        </select>
      </div>
      <div class="field"><label for="g-desc-{goal.id}">설명</label><textarea id="g-desc-{goal.id}" class="textarea" rows="2" bind:value={description}></textarea></div>
      <div class="field"><label for="g-sc-{goal.id}">달성 기준</label><textarea id="g-sc-{goal.id}" class="textarea" rows="2" bind:value={successCriteria}></textarea></div>
      <div class="field"><label for="g-pn-{goal.id}">진척 메모 (리포트에 반영)</label><textarea id="g-pn-{goal.id}" class="textarea" rows="3" bind:value={progressNote}></textarea></div>
      <div class="row">
        <button class="btn sm primary" onclick={save} disabled={busy || !title.trim()}>저장</button>
        <button class="btn sm" onclick={() => (editing = false)}>취소</button>
        <button class="btn sm danger" onclick={remove}>삭제</button>
      </div>
    </div>
  {:else}
    <div class="head">
      <h3>{goal.title}</h3>
      <select class="pill-select status-{goal.status}" value={goal.status} onchange={(e) => setStatus(e.currentTarget.value as GoalStatus)} aria-label="목표 상태">
        {#each GOAL_STATUSES as s (s)}<option value={s}>{GOAL_STATUS_LABEL[s]}</option>{/each}
      </select>
    </div>
    {#if goal.epic}
      <span class="muted small">Epic · {goal.epic.title}</span>
    {/if}
    {#if goal.progressNote}
      <p class="note">{goal.progressNote}</p>
    {:else if goal.successCriteria}
      <p class="note muted">달성 기준: {goal.successCriteria}</p>
    {/if}
    <div class="foot">
      <span class="muted small">연결된 활동 {goal.activities.length}건</span>
      <button class="btn sm" onclick={startEdit}>편집</button>
    </div>
  {/if}
</article>

<style>
  .goal {
    padding: 14px 16px;
    border: 1px solid #e1e8e4;
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .goal.busy {
    opacity: 0.6;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  }
  .head h3 {
    line-height: 1.45;
  }
  .pill-select {
    flex: none;
    border: none;
    border-radius: 999px;
    padding: 2px 24px 2px 10px;
    font-size: 12px;
    font-weight: 600;
    appearance: none;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='3'><path d='M6 9l6 6 6-6'/></svg>");
    background-repeat: no-repeat;
    background-position: right 8px center;
    cursor: pointer;
  }
  .note {
    margin: 0;
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-2);
    white-space: pre-line;
  }
  .foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .small {
    font-size: 12px;
  }
  .danger {
    color: #8a1f1f;
    margin-left: auto;
  }
</style>
