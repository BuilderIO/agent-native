import { defineConfig, mergeConfig } from "vitest/config";

import base from "../vitest.config";

// The one run the coverage ratchet reads. Only this config adds the mode
// reporter, so an ordinary `vitest --run` writes nothing.
export default mergeConfig(
  base,
  defineConfig({
    test: { reporters: ["default", "./oracle/mode-reporter.ts"] },
  }),
);
