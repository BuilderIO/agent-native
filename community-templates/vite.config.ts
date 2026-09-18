import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const appSlugs = readdirSync(new URL("./apps/", import.meta.url), {
  withFileTypes: true,
})
  .filter(
    (entry) =>
      entry.isDirectory() &&
      existsSync(new URL(`./apps/${entry.name}/index.html`, import.meta.url)),
  )
  .map((entry) => entry.name)
  .sort();

const page = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: Object.fromEntries([
        ["catalog", page("./index.html")],
        ...appSlugs.map((slug) => [slug, page(`./apps/${slug}/index.html`)]),
      ]),
    },
  },
});
