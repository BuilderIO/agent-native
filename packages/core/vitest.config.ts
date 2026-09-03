// Core owns the shared base config, so it reads the source directly rather than
// going through the monorepo-root re-export.
import { ensureNativeDependencies } from "./src/cli/native-dependencies.ts";
import baseConfig from "./src/vitest-config";

// Core specs import the native driver directly, before app startup can repair it.
ensureNativeDependencies({ repair: true, label: "vitest" });

export default baseConfig;
