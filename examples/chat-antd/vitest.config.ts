import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": resolve("./app") } },
  test: { environment: "happy-dom", passWithNoTests: true },
});
