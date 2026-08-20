import path from "node:path";

import { defineConfig } from "vitest/config";

// Keep tests independent from vite.config.ts: the production config starts
// Nitro/Vite watchers and evaluates browser-targeted CommonJS SSR modules.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./app"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
});
