import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./app"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
  test: {
    hookTimeout: 60000,
    include: ["**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    exclude: [
      "**/node_modules/**",
      "**/.git/**",
      "**/dist/**",
      "**/.output/**",
      "**/.react-router/**",
      "**/e2e/**",
    ],
  },
});
