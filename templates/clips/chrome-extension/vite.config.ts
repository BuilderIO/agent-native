import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const root = dirname(fileURLToPath(import.meta.url));

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function resolveSentryDsn(): string {
  const direct = firstNonEmpty(
    process.env.SENTRY_CLIENT_DSN,
    process.env.VITE_SENTRY_CLIENT_DSN,
    process.env.VITE_SENTRY_DSN,
    process.env.SENTRY_DSN,
  );
  if (direct) return direct;

  const key = firstNonEmpty(
    process.env.SENTRY_CLIENT_KEY,
    process.env.VITE_SENTRY_CLIENT_KEY,
  );
  const projectId = firstNonEmpty(
    process.env.SENTRY_PROJECT_ID,
    process.env.VITE_SENTRY_PROJECT_ID,
  );
  const host = firstNonEmpty(
    process.env.SENTRY_INGEST_HOST,
    process.env.VITE_SENTRY_INGEST_HOST,
  );
  return key && projectId && host ? `https://${key}@${host}/${projectId}` : "";
}

function resolveSentryEnvironment(): string {
  return (
    firstNonEmpty(
      process.env.SENTRY_ENVIRONMENT,
      process.env.NETLIFY_CONTEXT,
      process.env.VERCEL_ENV,
      process.env.NODE_ENV,
    ) || "production"
  );
}

export default defineConfig({
  root,
  base: "./",
  publicDir: "public",
  define: {
    __CLIPS_SENTRY_DSN__: JSON.stringify(resolveSentryDsn()),
    __CLIPS_SENTRY_ENVIRONMENT__: JSON.stringify(resolveSentryEnvironment()),
  },
  // Share recording primitives with the web app recorder (templates/clips/shared)
  // — matches the "@shared/*" tsconfig path so imports resolve in both builds.
  resolve: {
    alias: { "@shared": resolve(root, "../shared") },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        background: resolve(root, "src/background.ts"),
        "content-script": resolve(root, "src/content-script.ts"),
        offscreen: resolve(root, "src/offscreen.html"),
        overlay: resolve(root, "src/overlay.html"),
        permission: resolve(root, "src/permission.html"),
        popup: resolve(root, "src/popup.html"),
        options: resolve(root, "src/options.html"),
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
