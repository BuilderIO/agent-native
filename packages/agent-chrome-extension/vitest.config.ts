import { mergeConfig } from "vitest/config";

import baseConfig from "../../vitest.shared";
import viteConfig from "./vite.config";

// Kept separate from vite.config.ts so the production config never imports
// vitest: `agent-native build` loads vite.config.ts in installs where vitest
// is absent.
export default mergeConfig(viteConfig, baseConfig);
