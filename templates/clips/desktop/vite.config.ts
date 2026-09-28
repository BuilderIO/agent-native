import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
) as { version?: string };

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function resolveSentryDsn(): string {
  const direct = firstNonEmpty(
    process.env.CLIPS_DESKTOP_SENTRY_DSN,
    process.env.TAURI_SENTRY_DSN,
    process.env.SENTRY_DESKTOP_DSN,
    process.env.SENTRY_CLIENT_DSN,
    process.env.VITE_SENTRY_CLIENT_DSN,
    process.env.VITE_SENTRY_DSN,
    process.env.SENTRY_DSN,
  );
  if (direct) return direct;

  const key = firstNonEmpty(
    process.env.CLIPS_DESKTOP_SENTRY_CLIENT_KEY,
    process.env.SENTRY_CLIENT_KEY,
    process.env.VITE_SENTRY_CLIENT_KEY,
  );
  const projectId = firstNonEmpty(
    process.env.CLIPS_DESKTOP_SENTRY_PROJECT_ID,
    process.env.SENTRY_PROJECT_ID,
    process.env.VITE_SENTRY_PROJECT_ID,
  );
  const host = firstNonEmpty(
    process.env.CLIPS_DESKTOP_SENTRY_INGEST_HOST,
    process.env.SENTRY_INGEST_HOST,
    process.env.VITE_SENTRY_INGEST_HOST,
  );
  return key && projectId && host ? `https://${key}@${host}/${projectId}` : "";
}

function resolveSentryEnvironment(): string {
  return (
    firstNonEmpty(
      process.env.CLIPS_DESKTOP_SENTRY_ENVIRONMENT,
      process.env.SENTRY_ENVIRONMENT,
      process.env.NETLIFY_CONTEXT,
      process.env.VERCEL_ENV,
      process.env.NODE_ENV,
    ) || "production"
  );
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(root, "src"),
    },
  },
  clearScreen: false,
  define: {
    __CLIPS_DESKTOP_SENTRY_DSN__: JSON.stringify(resolveSentryDsn()),
    __CLIPS_DESKTOP_SENTRY_ENVIRONMENT__: JSON.stringify(
      resolveSentryEnvironment(),
    ),
    __CLIPS_DESKTOP_VERSION__: JSON.stringify(packageJson.version ?? "0.0.0"),
    __CLIPS_DESKTOP_LOCAL_BUILD__: JSON.stringify(
      process.env.CLIPS_DESKTOP_LOCAL_BUILD === "1",
    ),
  },
  server: {
    port: 1420,
    strictPort: true,
    hmr: {
      protocol: "ws",
      host: "localhost",
      port: 1420,
    },
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2021",
    minify: "esbuild",
    sourcemap: false,
  },
});
