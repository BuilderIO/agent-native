import { defineConfig } from "vitest/config";

import appConfig from "./vitest.config.ts";

export default defineConfig({
  ...(appConfig.resolve ? { resolve: appConfig.resolve } : {}),
  oxc: { jsx: { development: false } },
  test: {
    include: ["build-tests/**/*.spec.ts"],
    maxWorkers: 2,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
