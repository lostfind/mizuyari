<script lang="ts">
  import { onMount } from "svelte";
  import type { Activity, Epic, Sprint, SprintDetail } from "$shared/types";
  import ActivityRow from "../components/ActivityRow.svelte";
  import GoalCard from "../components/GoalCard.svelte";
  import { api, ApiError } from "../lib/api";
  import { todayYmd, ymdShort } from "../lib/format";
  import { router } from "../lib/router.svelte";
  import { isSubmitEnter } from "../lib/keys";

  let { id }: { id?: number } = $props();

  let detail = $state<SprintDetail | null>(null);
  let sprints = $state<Sprint[]>([]);
  let epics = $state<Epic[]>([]);
  let loading = $state(true);
  let error = $state("");
  let filter = $state<"all" | "github" | "google" | "task" | "manual">("all");

  // 새 목표
  let newTitle = $state("");
  let newEpicId = $state<number | "">("");
  let adding = $state(false);

  // 새 스프린트
  let creatingSprint = $state(false);
  let newStart = $state(todayYmd());

  // 다음 스프린트 (현재 스프린트에서 이어 만들기)
  let nextOpen = $state(false);
  let nextStart = $state("");
  let carryIds = $state<number[]>([]);
  let closeCurrent = $state(true);

  // 수동 활동
  let manualTitle = $state("");
  let manualOpen = $state(false);

  async function load() {
    loading = true;
    error = "";
    try {
      [sprints, epics] = await Promise.all([api.sprints.list(), api.epics.list("active")]);
      detail = id ? await api.sprints.get(id) : await api.sprints.current();
    } catch (e) {
      error = e instanceof ApiError ? e.message : "불러오지 못했습니다";
      detail = null;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void id;
    load();
  });

  onMount(() => {
    const h = () => load();
    window.addEventListener("mz:synced", h);
    return () => window.removeEventListener("mz:synced", h);
  });

  async function addGoal() {
    if (!detail || !newTitle.trim()) return;
    adding = true;
    try {
      await api.goals.create({
        sprintId: detail.sprint.id,
        title: newTitle.trim(),
        epicId: newEpicId === "" ? null : Number(newEpicId),
        order: detail.goals.length,
      });
      newTitle = "";
      newEpicId = "";
      await load();
    } finally {
      adding = false;
    }
  }

  async function createSprint() {
    creatingSprint = true;
    try {
      const s = await api.sprints.create({ startDate: newStart });
      router.go({ name: "sprint", id: s.id });
    } finally {
      creatingSprint = false;
    }
  }

  function openNext() {
    if (!detail) return;
    const d = new Date(`${detail.sprint.endDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    nextStart = d.toISOString().slice(0, 10);
    // 끝내지 못한 목표는 기본으로 이월
    carryIds = detail.goals.filter((g) => g.status !== "achieved" && g.status !== "dropped").map((g) => g.id);
    closeCurrent = detail.sprint.status === "active";
    nextOpen = true;
  }

  async function createNext() {
    if (!detail || !nextStart) return;
    creatingSprint = true;
    try {
      const s = await api.sprints.next(detail.sprint.id, { startDate: nextStart, carryGoalIds: carryIds, closeCurrent });
      nextOpen = false;
      router.go({ name: "sprint", id: s.id });
    } catch (e) {
      error = e instanceof ApiError ? e.message : "스프린트를 만들지 못했습니다";
    } finally {
      creatingSprint = false;
    }
  }

  async function addManual() {
    if (!manualTitle.trim()) return;
    await api.activities.create({ title: manualTitle.trim() });
    manualTitle = "";
    manualOpen = false;
    await load();
  }

  function onActivityChange(updated: Activity) {
    if (!detail) return;
    // 재조회 대신 로컬 갱신 (연결 변경은 목록 간 이동이 필요하므로 재조회)
    const wasLinked = detail.goals.some((g) => g.activities.some((a) => a.id === updated.id));
    const nowLinked = updated.goalId !== null;
    if (wasLinked !== nowLinked || (nowLinked && !detail.goals.find((g) => g.id === updated.goalId)?.activities.some((a) => a.id === updated.id))) {
      load();
      return;
    }
    detail.unlinkedActivities = detail.unlinkedActivities.map((a) => (a.id === updated.id ? updated : a));
    for (const g of detail.goals) g.activities = g.activities.map((a) => (a.id === updated.id ? updated : a));
  }

  const allActivities = $derived.by(() => {
    if (!detail) return [] as Activity[];
    const linked = detail.goals.flatMap((g) => g.activities);
    return [...linked, ...detail.unlinkedActivities].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  });

  const filtered = $derived(
    allActivities.filter((a) => {
      if (filter === "all") return true;
      if (filter === "github") return a.source.startsWith("github");
      if (filter === "google") return a.source === "google_task" || a.source === "calendar_event";
      if (filter === "task") return a.taskId !== null || a.source === "task_status";
      return a.source === "manual";
    }),
  );

  const goalOptions = $derived(detail?.goals.map((g) => ({ id: g.id, title: g.title })) ?? []);
  const outsideCount = $derived(detail?.unlinkedActivities.length ?? 0);
  const meetingSoon = $derived.by(() => {
    if (!detail?.sprint.meetingDate) return "";
    const diff = Math.round((new Date(detail.sprint.meetingDate).getTime() - new Date(todayYmd()).getTime()) / 86400000);
    if (diff < 0) return `${ymdShort(detail.sprint.meetingDate)} (지남)`;
    if (diff === 0) return `${ymdShort(detail.sprint.meetingDate)} (오늘)`;
    if (diff === 1) return `${ymdShort(detail.sprint.meetingDate)} (내일)`;
    return `${ymdShort(detail.sprint.meetingDate)} (D-${diff})`;
  });
</script>

<div class="page">
  {#if loading && !detail}
    <div class="empty">불러오는 중…</div>
  {:else if error}
    <div class="error">{error}</div>
  {:else if !detail}
    <div class="card new-sprint">
      <h2>진행 중인 스프린트가 없습니다</h2>
      <p class="muted">시작일을 정하면 2주짜리 스프린트를 만듭니다. 미팅일은 종료 다음 날로 잡힙니다.</p>
      <div class="row">
        <input type="date" class="input" bind:value={newStart} style="width:auto" />
        <button class="btn primary" onclick={createSprint} disabled={creatingSprint}>스프린트 만들기</button>
      </div>
    </div>
  {:else}
    <div class="page-head">
      <div class="stack" style="gap:6px">
        <div class="row">
          <select class="select" style="width:auto" value={detail.sprint.id} onchange={(e) => router.go({ name: "sprint", id: Number(e.currentTarget.value) })} aria-label="스프린트 선택">
            {#each sprints as s (s.id)}
              <option value={s.id}>{ymdShort(s.startDate)} – {ymdShort(s.endDate)}{s.status === "closed" ? " (종료)" : ""}</option>
            {/each}
          </select>
          {#if detail.sprint.status === "closed"}<span class="pill status-not_started">종료됨</span>{/if}
        </div>
        <div class="row">
          <h1>{detail.sprint.startDate} – {detail.sprint.endDate}</h1>
          {#if meetingSoon}<span class="pill status-partial">컨디셔닝 미팅 {meetingSoon}</span>{/if}
        </div>
      </div>
      <div class="row">
        <button class="btn" onclick={() => (manualOpen = !manualOpen)}>활동 직접 추가</button>
        <button class="btn" onclick={() => (nextOpen ? (nextOpen = false) : openNext())}>다음 스프린트</button>
        <a class="btn primary" href="/report?sprint={detail.sprint.id}" use:router.link>리포트 초안 만들기</a>
      </div>
    </div>

    {#if manualOpen}
      <div class="card manual row">
        <input class="input" style="flex:1" bind:value={manualTitle} placeholder="수집되지 않는 활동 (예: 온보딩 자료 검토)" onkeydown={(e) => isSubmitEnter(e) && addManual()} />
        <button class="btn primary" onclick={addManual} disabled={!manualTitle.trim()}>추가</button>
      </div>
    {/if}

    {#if nextOpen}
      <div class="card next-sprint">
        <div class="row">
          <label class="row" style="gap:6px">시작일 <input type="date" class="input" bind:value={nextStart} style="width:auto" /></label>
          <span class="muted">2주 뒤 종료, 미팅일은 종료 다음 날</span>
        </div>
        {#if detail.goals.length}
          <fieldset>
            <legend>이월할 목표 (같은 Epic 아래 새 목표로 복사)</legend>
            {#each detail.goals as g (g.id)}
              <label class="row" style="gap:6px"><input type="checkbox" value={g.id} bind:group={carryIds} />{g.title}</label>
            {/each}
          </fieldset>
        {/if}
        {#if detail.sprint.status === "active"}
          <label class="row" style="gap:6px"><input type="checkbox" bind:checked={closeCurrent} />현재 스프린트 종료</label>
        {/if}
        <div class="row">
          <button class="btn primary" onclick={createNext} disabled={creatingSprint || !nextStart}>만들기</button>
          <button class="btn" onclick={() => (nextOpen = false)}>취소</button>
        </div>
      </div>
    {/if}

    <div class="cols">
      <section class="card goals" aria-labelledby="goals-h">
        <div class="sec-head">
          <h2 id="goals-h">이번 스프린트 목표</h2>
        </div>
        {#each detail.goals as g (g.id)}
          <GoalCard goal={g} {epics} onchange={load} ondelete={load} />
        {/each}
        {#if detail.sprint.status === "active"}
          <div class="add-goal">
            <input class="input title" bind:value={newTitle} placeholder="새 목표" onkeydown={(e) => isSubmitEnter(e) && addGoal()} />
            <select class="select epic" bind:value={newEpicId} aria-label="Epic">
              <option value="">Epic 없음</option>
              {#each epics as e (e.id)}<option value={e.id}>{e.title}</option>{/each}
            </select>
            <button class="btn primary" onclick={addGoal} disabled={adding || !newTitle.trim()}>추가</button>
          </div>
        {/if}
        <div class="outside">
          <strong>목표 이외의 활동 {outsideCount}건</strong>
          <span>리포트의 "목표 이외의 행동·성과" 후보입니다. 목표와 관계있으면 오른쪽에서 연결하세요.</span>
        </div>
      </section>

      <section class="card acts" aria-labelledby="acts-h">
        <div class="sec-head wrap">
          <h2 id="acts-h">수집된 활동 <span class="muted" style="font-weight:400;font-size:14px">{filtered.length}건</span></h2>
          <div class="filters" role="group" aria-label="출처 필터">
            {#each [["all", "전체"], ["github", "GitHub"], ["google", "Google"], ["task", "Task"], ["manual", "직접"]] as [k, label] (k)}
              <button class="f" class:on={filter === k} aria-pressed={filter === k} onclick={() => (filter = k as typeof filter)}>{label}</button>
            {/each}
          </div>
        </div>
        {#if filtered.length === 0}
          <div class="empty">이 기간에 수집된 활동이 없습니다. 상단의 "지금 동기화"를 눌러 보세요.</div>
        {:else}
          <ul class="list">
            {#each filtered as a (a.id)}
              <ActivityRow activity={a} goals={goalOptions} onchange={onActivityChange} />
            {/each}
          </ul>
        {/if}
      </section>
    </div>
  {/if}
</div>

<style>
  .new-sprint {
    padding: 28px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .new-sprint p {
    margin: 0;
  }
  .manual {
    padding: 12px 16px;
  }
  .next-sprint {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .next-sprint fieldset {
    border: 0;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .next-sprint legend {
    padding: 0;
    margin-bottom: 4px;
    font-weight: 600;
  }
  .cols {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    align-items: flex-start;
  }
  .goals {
    flex: 1 1 340px;
    min-width: 0;
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .acts {
    flex: 999 1 520px;
    min-width: 0;
    overflow: hidden;
  }
  .sec-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .acts .sec-head {
    padding: 18px;
  }
  .sec-head.wrap {
    flex-wrap: wrap;
  }
  /* 제목 입력은 한 줄을 다 쓰고, Epic 선택과 버튼은 아랫줄. Epic 제목이 길어도 입력란이 좁아지지 않는다. */
  .add-goal {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
  }
  .add-goal .title {
    grid-column: 1 / -1;
  }
  .add-goal .epic {
    min-width: 0;
    text-overflow: ellipsis;
  }
  .outside {
    padding: 12px 14px;
    border-radius: 10px;
    background: #fff8ec;
    border: 1px dashed var(--warn-border);
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: #6b4a12;
  }
  .outside strong {
    color: var(--warn);
    font-size: 14px;
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .f {
    min-height: 34px;
    padding: 4px 14px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-2);
    font-size: 13px;
    cursor: pointer;
  }
  .f.on {
    background: var(--text);
    border-color: var(--text);
    color: #fff;
  }
  .list {
    margin: 0;
    padding: 0;
  }
</style>
