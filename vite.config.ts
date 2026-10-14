import { fileURLToPath, URL } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [svelte(), cloudflare()],
  resolve: {
    alias: {
      $shared: fileURLToPath(new URL("./src/shared", import.meta.url)),
      $lib: fileURLToPath(new URL("./src/client/lib", import.meta.url)),
    },
  },
});
