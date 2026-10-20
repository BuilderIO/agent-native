import path from "node:path";

import baseConfig from "@agent-native/core/vitest-config";
import { defineConfig, mergeConfig } from "vitest/config";

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
