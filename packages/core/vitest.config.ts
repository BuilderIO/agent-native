import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "./src/vitest-config";

export default mergeConfig(
  baseConfig,
  defineConfig({ test: { setupFiles: ["./vitest.setup.ts"] } }),
);
