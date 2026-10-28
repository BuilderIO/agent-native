import { mergeConfig } from "vitest/config";

import baseConfig from "../../vitest.shared";
import viteConfig from "./vite.config";

export default mergeConfig(viteConfig, baseConfig);
