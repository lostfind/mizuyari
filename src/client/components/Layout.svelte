<script lang="ts">
  import type { Snippet } from "svelte";
  import { onMount } from "svelte";
  import { api, type SyncStatus } from "../lib/api";
  import { relTime } from "../lib/format";
  import { router } from "../lib/router.svelte";
  import { session } from "../lib/session.svelte";
  import Logo from "./Logo.svelte";

  let { children }: { children: Snippet } = $props();

  const nav = [
    { name: "today", label: "Today", href: "/" },
    { name: "board", label: "Board", href: "/board" },
    { name: "sprint", label: "Sprint", href: "/sprint" },
    { name: "report", label: "Report", href: "/report" },
    { name: "archive", label: "Archive", href: "/archive" },
    { name: "epics", label: "Epics", href: "/epics" },
  ] as const;

  let syncStatus = $state<SyncStatus[]>([]);
  let syncing = $state(false);
  let syncMsg = $state("");

  const lastSync = $derived.by(() => {
    const times = syncStatus.map((s) => s.at).filter((x): x is string => !!x);
    if (!times.length) return null;
    return times.sort().at(-1) ?? null;
  });
  const syncError = $derived(syncStatus.find((s) => s.result === "error")?.error ?? null);

  async function loadStatus() {
    try {
      syncStatus = await api.sync.status();
    } catch {
      /* ignore */
    }
  }

  async function syncNow() {
    syncing = true;
    syncMsg = "";
    try {
      const results = await api.sync.run();
      const ok = results.filter((r) => r.ok);
      const bad = results.filter((r) => !r.ok);
      syncMsg = `+${ok.reduce((n, r) => n + r.inserted, 0)}건` + (bad.length ? ` · 실패 ${bad.map((b) => b.provider).join(", ")}` : "");
      await loadStatus();
      window.dispatchEvent(new CustomEvent("mz:synced"));
    } catch (e) {
      syncMsg = e instanceof Error ? e.message : "동기화 실패";
    } finally {
      syncing = false;
      setTimeout(() => (syncMsg = ""), 6000);
    }
  }

  onMount(loadStatus);
</script>

<header class="top">
  <a href="/" use:router.link class="brand">
    <Logo />
    <span>Mizuyari</span>
  </a>
  <nav class="desktop-nav" aria-label="주요 메뉴">
    {#each nav as item (item.name)}
      <a href={item.href} use:router.link class:active={router.route.name === item.name} aria-current={router.route.name === item.name ? "page" : undefined}>
        {item.label}
      </a>
    {/each}
  </nav>
  <div class="right">
    <span class="sync-info mono" title={syncError ?? ""}>
      {#if syncMsg}
        {syncMsg}
      {:else if syncError}
        <span class="err">수집 오류</span>
      {:else}
        수집 {relTime(lastSync)}
      {/if}
    </span>
    <button class="btn sm" onclick={syncNow} disabled={syncing}>{syncing ? "동기화 중…" : "지금 동기화"}</button>
    <a href="/settings" use:router.link class="btn sm icon" aria-label="설정" title="설정">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
      </svg>
    </a>
  </div>
</header>

<main>
  {@render children()}
</main>

<nav class="mobile-nav" aria-label="주요 메뉴 (모바일)">
  {#each nav.slice(0, 5) as item (item.name)}
    <a href={item.href} use:router.link class:active={router.route.name === item.name}>{item.label}</a>
  {/each}
</nav>

<style>
  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 28px;
    padding: 12px 24px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--text);
    text-decoration: none;
  }
  .desktop-nav {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    flex: 1 1 auto;
  }
  .desktop-nav a {
    padding: 8px 14px;
    border-radius: 8px;
    text-decoration: none;
    color: var(--text-2);
  }
  .desktop-nav a:hover {
    background: var(--surface-muted);
  }
  .desktop-nav a.active {
    background: var(--accent-tint);
    color: var(--accent-strong);
    font-weight: 600;
  }
  .right {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-left: auto;
  }
  .sync-info {
    font-size: 12px;
    color: var(--text-3);
  }
  .err {
    color: #8a1f1f;
  }
  .btn.icon {
    padding: 0 8px;
  }
  .mobile-nav {
    display: none;
  }
  @media (max-width: 720px) {
    .desktop-nav {
      display: none;
    }
    .sync-info {
      display: none;
    }
    .mobile-nav {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      display: flex;
      background: var(--surface);
      border-top: 1px solid var(--border);
      padding: 6px 4px calc(10px + env(safe-area-inset-bottom));
      z-index: 10;
    }
    .mobile-nav a {
      flex: 1 1 0;
      text-align: center;
      padding: 10px 0;
      font-size: 12px;
      text-decoration: none;
      color: var(--text-3);
      border-radius: 8px;
    }
    .mobile-nav a.active {
      color: var(--accent-strong);
      font-weight: 600;
    }
  }
</style>
