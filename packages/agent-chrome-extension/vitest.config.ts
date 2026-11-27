import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "../../vitest.shared";
import viteConfig from "./vite.config";

export default mergeConfig(
  mergeConfig(viteConfig, baseConfig),
  defineConfig({
    test: {
      isolate: false,
    },
  }),
);
