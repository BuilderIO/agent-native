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
    // The existing *.spec.ts files in this template are standalone tsx scripts
    // that call process.exit() directly — they predate vitest and run via tsx.
    // Exclude them so vitest does not attempt to execute them as test suites.
    // Remove this exclude entry when those files are migrated to proper vitest tests.
    include: ["**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    exclude: [
      "**/node_modules/**",
      "**/.git/**",
      "**/dist/**",
      "shared/types.public-settings.spec.ts",
      "server/lib/submission-validation.spec.ts",
    ],
    passWithNoTests: true,
  },
});
