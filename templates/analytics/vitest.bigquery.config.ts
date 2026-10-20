import { defineConfig } from "vitest/config";

import config from "./vitest.config";

export default defineConfig({
  ...config,
  test: {
    ...config.test,
    include: ["**/*.bigquery.integration.spec.ts"],
    exclude: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
  },
});
