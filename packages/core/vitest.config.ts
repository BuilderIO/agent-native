// Core owns the shared base config, so it reads the source directly rather than
// going through the monorepo-root re-export.
import baseConfig from "./src/vitest-config";

export default baseConfig;
