<script lang="ts">
  import { onMount } from "svelte";
  import Layout from "./components/Layout.svelte";
  import { router } from "./lib/router.svelte";
  import { session } from "./lib/session.svelte";
  import Archive from "./routes/Archive.svelte";
  import Board from "./routes/Board.svelte";
  import Epics from "./routes/Epics.svelte";
  import Login from "./routes/Login.svelte";
  import Report from "./routes/Report.svelte";
  import Settings from "./routes/Settings.svelte";
  import Sprint from "./routes/Sprint.svelte";
  import Today from "./routes/Today.svelte";

  onMount(() => {
    session.load();
    const onUnauthorized = () => {
      session.user = null;
    };
    window.addEventListener("mz:unauthorized", onUnauthorized);
    return () => window.removeEventListener("mz:unauthorized", onUnauthorized);
  });
</script>

{#if !session.loaded}
  <div class="splash">불러오는 중…</div>
{:else if !session.user}
  <Login />
{:else}
  <Layout>
    {#if router.route.name === "today"}
      <Today />
    {:else if router.route.name === "board"}
      <Board />
    {:else if router.route.name === "sprint"}
      <Sprint id={router.route.id} />
    {:else if router.route.name === "report"}
      <Report id={router.route.id} />
    {:else if router.route.name === "archive"}
      <Archive period={router.route.period} />
    {:else if router.route.name === "epics"}
      <Epics id={router.route.id} />
    {:else if router.route.name === "settings"}
      <Settings />
    {:else}
      <Today />
    {/if}
  </Layout>
{/if}

<style>
  .splash {
    display: grid;
    place-items: center;
    min-height: 60vh;
    color: var(--text-3);
  }
</style>
