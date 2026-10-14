<script lang="ts">
  let { size = 22 }: { size?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="var(--accent)"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d="M12 3c3.5 4.2 6 7.5 6 10.5a6 6 0 0 1-12 0C6 10.5 8.5 7.2 12 3z" />
</svg>
