<script lang="ts">
  import type { Activity, Epic, EpicStatus, Goal, Sprint } from "$shared/types";
  import { EPIC_STATUSES } from "$shared/types";
  import { api } from "../lib/api";
  import { EPIC_STATUS_LABEL, GOAL_STATUS_LABEL, md, ymdShort } from "../lib/format";
  import { router } from "../lib/router.svelte";

  let { id }: { id?: number } = $props();

  let epics = $state<Epic[]>([]);
  let detail = $state<{ epic: Epic; goals: Array<{ goal: Goal; sprint: Sprint }>; activities: Activity[] } | null>(null);
  let newTitle = $state("");
  let editing = $state(false);
  let eTitle = $state("");
  let eDesc = $state("");
  let eNote = $state("");
  let eStatus = $state<EpicStatus>("active");

  async function load() {
    epics = await api.epics.list();
    detail = id ? await api.epics.get(id) : null;
    editing = false;
  }

  $effect(() => {
    void id;
    load();
  });

  async function add() {
    if (!newTitle.trim()) return;
    const e = await api.epics.create({ title: newTitle.trim(), order: epics.length });
    newTitle = "";
    router.go({ name: "epics", id: e.id });
  }

  function startEdit() {
    if (!detail) return;
    eTitle = detail.epic.title;
    eDesc = detail.epic.description ?? "";
    eNote = detail.epic.progressNote ?? "";
    eStatus = detail.epic.status;
    editing = true;
  }

  async function save() {
    if (!detail) return;
    await api.epics.update(detail.epic.id, { title: eTitle.trim(), description: eDesc.trim() || null, progressNote: eNote.trim() || null, status: eStatus });
    await load();
  }

  async function remove() {
    if (!detail) return;
    if (!confirm(`Epic "${detail.epic.title}"을(를) 삭제합니다. 연결된 Goal은 Epic 없는 상태로 남습니다.`)) return;
    await api.epics.remove(detail.epic.id);
    router.go({ name: "epics" });
  }
</script>

<div class="page">
  <div class="page-head">
    <div class="stack" style="gap:4px">
      <h1>Epics</h1>
      <span class="muted">스프린트를 넘어 이어지는 긴 목표. 2주 목표(Goal)는 Epic 아래에 붙습니다.</span>
    </div>
  </div>

  <div class="cols">
    <aside class="card list">
      <div class="add">
        <input class="input" bind:value={newTitle} placeholder="새 Epic" onkeydown={(e) => e.key === "Enter" && add()} />
        <button class="btn primary sm" onclick={add} disabled={!newTitle.trim()}>추가</button>
      </div>
      {#each ["active", "paused", "done"] as st (st)}
        {@const group = epics.filter((e) => e.status === st)}
        {#if group.length}
          <span class="grp muted">{EPIC_STATUS_LABEL[st as EpicStatus]}</span>
          {#each group as e (e.id)}
            <a href="/epics/{e.id}" use:router.link class="item" class:on={e.id === id}>{e.title}</a>
          {/each}
        {/if}
      {/each}
      {#if epics.length === 0}<div class="empty">아직 Epic이 없습니다.</div>{/if}
    </aside>

    <section class="card detail">
      {#if !detail}
        <div class="empty">왼쪽에서 Epic을 고르거나 새로 만드세요.</div>
      {:else if editing}
        <div class="stack">
          <div class="field"><label for="et">제목</label><input id="et" class="input" bind:value={eTitle} /></div>
          <div class="field">
            <label for="es">상태</label>
            <select id="es" class="select" bind:value={eStatus}>{#each EPIC_STATUSES as s (s)}<option value={s}>{EPIC_STATUS_LABEL[s]}</option>{/each}</select>
          </div>
          <div class="field"><label for="ed">설명</label><textarea id="ed" class="textarea" rows="3" bind:value={eDesc}></textarea></div>
          <div class="field"><label for="en">진척 메모 (기간 리포트에 반영)</label><textarea id="en" class="textarea" rows="4" bind:value={eNote}></textarea></div>
          <div class="row" style="justify-content:space-between">
            <button class="btn" style="color:#8a1f1f" onclick={remove}>삭제</button>
            <div class="row">
              <button class="btn" onclick={() => (editing = false)}>취소</button>
              <button class="btn primary" onclick={save} disabled={!eTitle.trim()}>저장</button>
            </div>
          </div>
        </div>
      {:else}
        <div class="row" style="justify-content:space-between">
          <h2>{detail.epic.title}</h2>
          <div class="row">
            <span class="pill status-{detail.epic.status === 'done' ? 'achieved' : detail.epic.status === 'paused' ? 'not_started' : 'in_progress'}">{EPIC_STATUS_LABEL[detail.epic.status]}</span>
            <button class="btn sm" onclick={startEdit}>편집</button>
          </div>
        </div>
        {#if detail.epic.description}<p class="desc">{detail.epic.description}</p>{/if}
        {#if detail.epic.progressNote}<p class="desc note">{detail.epic.progressNote}</p>{/if}

        <h3>스프린트별 Goal</h3>
        {#if detail.goals.length === 0}
          <div class="empty">아직 연결된 Goal이 없습니다. Sprint 화면에서 목표를 만들 때 이 Epic을 지정하세요.</div>
        {:else}
          <ul class="plain">
            {#each detail.goals as g (g.goal.id)}
              <li class="row">
                <a class="mono muted" href="/sprint/{g.sprint.id}" use:router.link>{ymdShort(g.sprint.startDate)}–{ymdShort(g.sprint.endDate)}</a>
                <span>{g.goal.title}</span>
                <span class="pill status-{g.goal.status}">{GOAL_STATUS_LABEL[g.goal.status]}</span>
              </li>
            {/each}
          </ul>
        {/if}

        <h3>Epic에 직접 연결된 활동</h3>
        {#if detail.activities.length === 0}
          <div class="empty">없음</div>
        {:else}
          <ul class="plain">
            {#each detail.activities as a (a.id)}
              <li class="row"><span class="mono muted">{md(a.occurredAt)}</span>{#if a.url}<a href={a.url} target="_blank" rel="noopener">{a.title}</a>{:else}<span>{a.title}</span>{/if}</li>
            {/each}
          </ul>
        {/if}
      {/if}
    </section>
  </div>
</div>

<style>
  .cols {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    align-items: flex-start;
  }
  .list {
    flex: 1 1 240px;
    max-width: 320px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .add {
    display: flex;
    gap: 6px;
    margin-bottom: 8px;
  }
  .grp {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    padding: 8px 8px 2px;
  }
  .item {
    padding: 8px 10px;
    border-radius: 8px;
    text-decoration: none;
    color: var(--text);
  }
  .item:hover {
    background: var(--surface-muted);
  }
  .item.on {
    background: var(--accent-tint);
    color: var(--accent-strong);
    font-weight: 600;
  }
  .detail {
    flex: 999 1 420px;
    min-width: 0;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .desc {
    margin: 0;
    color: var(--text-2);
    white-space: pre-line;
  }
  .note {
    padding: 10px 12px;
    background: var(--surface-muted);
    border-radius: 8px;
  }
  .plain {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
  }
  @media (max-width: 640px) {
    .list {
      max-width: none;
    }
  }
</style>
