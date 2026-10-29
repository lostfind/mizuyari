<script lang="ts">
  import { onMount } from "svelte";
  import { DEFAULT_GITHUB_EXCLUDE_TITLES } from "$shared/types";
  import { api, type SyncStatus } from "../lib/api";
  import { relTime, todayYmd } from "../lib/format";
  import { session } from "../lib/session.svelte";

  let status = $state<SyncStatus[]>([]);
  let settings = $state<Record<string, string>>({});
  let excludeKeywords = $state("");
  let githubExcludeTitles = $state("");
  let colorLabels = $state<Record<string, string>>({});
  let config = $state<{ githubLogin: string | null; timezone: string; fiscalYearStartMonth: number; reportLang: string } | null>(null);
  let msg = $state("");
  let busy = $state(false);

  // 재수집
  let from = $state("");
  let to = $state(todayYmd());

  const providerLabel = { github: "GitHub", google_tasks: "Google Tasks", google_calendar: "Google Calendar" } as const;

  async function load() {
    [status, settings, config] = await Promise.all([api.sync.status(), api.sync.settings(), api.config()]);
    excludeKeywords = settings["calendar:exclude_keywords"] ?? "";
    githubExcludeTitles = settings["github:exclude_titles"] ?? DEFAULT_GITHUB_EXCLUDE_TITLES;
    colorLabels = parseJson(settings["calendar:color_labels"]);
  }

  function parseJson(raw: string | undefined): Record<string, string> {
    try {
      const v = raw ? JSON.parse(raw) : {};
      return v && typeof v === "object" ? v : {};
    } catch {
      return {};
    }
  }

  // 동기화 때 저장된 Google 일정 색상 팔레트 (colorId → 배경색)
  const palette = $derived(
    Object.entries(parseJson(settings["calendar:palette"]))
      .filter(([, c]) => /^#[0-9a-f]{6}$/i.test(c))
      .sort(([a], [b]) => Number(a) - Number(b)),
  );

  async function saveColorLabels() {
    busy = true;
    try {
      const cleaned = Object.fromEntries(
        Object.entries(colorLabels)
          .map(([k, v]) => [k, v.trim()])
          .filter(([, v]) => v),
      );
      settings = await api.sync.saveSettings({ "calendar:color_labels": JSON.stringify(cleaned) });
      msg = "저장했습니다";
    } finally {
      busy = false;
    }
  }

  onMount(load);

  async function saveSettings() {
    busy = true;
    try {
      settings = await api.sync.saveSettings({ "calendar:exclude_keywords": excludeKeywords });
      msg = "저장했습니다";
    } finally {
      busy = false;
    }
  }

  async function saveGithubExcludes() {
    busy = true;
    try {
      settings = await api.sync.saveSettings({ "github:exclude_titles": githubExcludeTitles.trim() });
      msg = "저장했습니다";
    } finally {
      busy = false;
    }
  }

  // 잘못된 정규식 줄 (서버는 이런 줄을 무시한다)
  const invalidPatterns = $derived(
    githubExcludeTitles
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => {
        if (!l) return false;
        try {
          new RegExp(l);
          return false;
        } catch {
          return true;
        }
      }),
  );

  async function resync() {
    if (!from || !to) return;
    busy = true;
    msg = "";
    try {
      const r = await api.sync.run({ from, to });
      msg = r.map((x) => `${providerLabel[x.provider]}: ${x.ok ? `+${x.inserted} ~${x.updated}` : `오류 ${x.error}`}`).join(" · ");
      await load();
      window.dispatchEvent(new CustomEvent("mz:synced"));
    } finally {
      busy = false;
    }
  }

  async function logout() {
    await session.logout();
  }
</script>

<div class="page narrow">
  <h1>설정</h1>

  {#if session.googleNeedsReauth}
    <div class="card notice">
      <strong>Google 권한이 바뀌었습니다.</strong>
      <span>TODO 완료 처리에 필요한 권한을 받으려면 Google에 다시 연결해 주세요.</span>
      <a class="btn primary sm" href="/auth/google/start">다시 연결</a>
    </div>
  {/if}

  <section class="card sec">
    <h2>계정</h2>
    <div class="row" style="justify-content:space-between">
      <div class="stack" style="gap:2px">
        <span>{session.user?.email}</span>
        <span class="muted small">Google {session.googleConnected ? "연결됨" : "미연결"} · GitHub {config?.githubLogin ?? "미설정"} · {config?.timezone}</span>
      </div>
      <div class="row">
        <a class="btn sm" href="/auth/google/start">Google 다시 연결</a>
        <button class="btn sm" onclick={logout}>로그아웃</button>
      </div>
    </div>
  </section>

  <section class="card sec">
    <h2>수집 상태</h2>
    <table class="tbl">
      <thead><tr><th>출처</th><th>마지막 실행</th><th>결과</th></tr></thead>
      <tbody>
        {#each status as s (s.provider)}
          <tr>
            <td>{providerLabel[s.provider]}</td>
            <td class="muted">{relTime(s.at)}</td>
            <td>{#if s.result === "error"}<span class="err" title={s.error ?? ""}>오류: {s.error?.slice(0, 80)}</span>{:else if s.result}<span class="ok">정상</span>{:else}<span class="muted">아직 없음</span>{/if}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    <p class="muted small">매일 09:00(JST)에 자동 수집됩니다. 수집 중 오류가 나면 상단 표시줄에 "수집 오류"가 뜹니다.</p>
  </section>

  <section class="card sec">
    <h2>기간 지정 재수집</h2>
    <p class="muted small">놓친 기간이 있거나 과거 활동을 채울 때 씁니다. GitHub는 최대 1년 범위까지 한 번에 조회됩니다.</p>
    <div class="row">
      <input type="date" class="input" style="width:auto" bind:value={from} />
      <span class="muted">–</span>
      <input type="date" class="input" style="width:auto" bind:value={to} />
      <button class="btn" onclick={resync} disabled={busy || !from || !to}>재수집</button>
    </div>
  </section>

  <section class="card sec">
    <h2>GitHub 가져오기 제외 제목</h2>
    <p class="muted small">제목이 이 정규식에 맞는 Issue·PR은 Board로 가져오지 않습니다. 줄마다 하나씩 적습니다. (기본: 릴리스 PR <code>Release 20261026151701</code>)</p>
    <textarea class="textarea mono" rows="3" bind:value={githubExcludeTitles} placeholder={DEFAULT_GITHUB_EXCLUDE_TITLES}></textarea>
    {#if invalidPatterns.length}<div class="error small">잘못된 정규식은 무시됩니다: {invalidPatterns.join(", ")}</div>{/if}
    <div class="row">
      <button class="btn primary" onclick={saveGithubExcludes} disabled={busy}>저장</button>
    </div>
  </section>

  <section class="card sec">
    <h2>Calendar 제외 키워드</h2>
    <p class="muted small">제목에 이 단어가 들어간 일정은 수집하지 않습니다. 쉼표로 구분합니다. (예: 집중, 점심, Focus)</p>
    <div class="row">
      <input class="input" style="flex:1" bind:value={excludeKeywords} placeholder="집중, 점심, Focus" />
      <button class="btn primary" onclick={saveSettings} disabled={busy}>저장</button>
    </div>
  </section>

  <section class="card sec">
    <h2>Calendar 색상 라벨</h2>
    <p class="muted small">Google Calendar API 는 색상에 붙인 이름을 제공하지 않아서, 여기서 색상별 라벨을 지정합니다. 비워 두면 라벨 없이 색만 표시합니다.</p>
    {#if palette.length === 0}
      <div class="muted small">Google Calendar 를 한 번 동기화하면 색상 목록이 나타납니다.</div>
    {:else}
      <div class="labels">
        {#each palette as [id, color] (id)}
          <label class="row label-row">
            <span class="swatch" style:background={color} aria-hidden="true"></span>
            <input class="input" value={colorLabels[id] ?? ""} oninput={(e) => (colorLabels[id] = e.currentTarget.value)} placeholder="라벨 (예: 외부 미팅)" aria-label="색상 {id} 라벨" />
          </label>
        {/each}
      </div>
      <div class="row">
        <button class="btn primary" onclick={saveColorLabels} disabled={busy}>저장</button>
      </div>
    {/if}
  </section>

  {#if msg}<div class="muted small">{msg}</div>{/if}
</div>

<style>
  .page.narrow {
    max-width: 760px;
  }
  .labels {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 8px 12px;
  }
  .label-row {
    flex-wrap: nowrap;
  }
  .swatch {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    flex: none;
  }
  .sec {
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .sec p {
    margin: 0;
  }
  .small {
    font-size: 12px;
  }
  .tbl {
    border-collapse: collapse;
    width: 100%;
    font-size: 13px;
  }
  .tbl th,
  .tbl td {
    text-align: left;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border-soft);
  }
  .tbl th {
    font-weight: 600;
    color: var(--text-3);
    font-size: 12px;
  }
  .ok {
    color: var(--green);
  }
  .notice {
    padding: 14px 16px;
    background: #fff8ec;
    border-color: var(--warn-border);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    color: #6b4a12;
  }
  .err {
    color: #8a1f1f;
  }
</style>
