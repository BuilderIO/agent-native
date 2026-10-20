import baseConfig from "@agent-native/core/vitest-config";
import { mergeConfig } from "vitest/config";

import viteConfig from "./vite.config";

export default mergeConfig(viteConfig, baseConfig);
