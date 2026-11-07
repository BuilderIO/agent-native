import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import baseConfig from "@agent-native/core/vitest-config";
import { defineConfig, mergeConfig } from "vitest/config";

// Mock the same internal modules used by Core in either workspace or npm layouts.
const coreDist = path.dirname(
  path.dirname(fileURLToPath(import.meta.resolve("@agent-native/core/audit"))),
);
const coreSrc = path.resolve(coreDist, "../src");
const coreTestHelpers = existsSync(
  path.join(coreSrc, "agent/execution-fence.ts"),
)
  ? coreSrc
  : coreDist;

// Tests run without the production Vite plugin stack: its SSR `noExternal`
// inlines the framework's CommonJS dependencies, so a test that loads the
// action registry cannot import them.
export default mergeConfig(
  baseConfig,
  defineConfig({
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./app"),
        "@shared": path.resolve(__dirname, "./shared"),
        "@factory-test/audit-store": path.join(coreDist, "audit/store.js"),
        "@factory-test/run-now": path.join(coreDist, "jobs/run-now.js"),
        "@factory-test/core-internals": coreTestHelpers,
      },
    },
    test: {
      // A spec that reaches the app's own database (the default tripwire
      // recorder, an action that calls `getDb()`) opens an in-memory PGlite, never
      // `data/pglite`, which the dev server holds open. Core reads this URL only
      // in a test process.
      env: { DATABASE_URL: "pglite:memory" },
      exclude: [
        "**/node_modules/**",
        "**/.git/**",
        "**/dist/**",
        "**/.react-router/**",
      ],
    },
  }),
);
