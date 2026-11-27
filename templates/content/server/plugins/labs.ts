import { T3_CODE_AGENTS_LAB } from "@agent-native/core/labs/core-labs";
import { createLabsPlugin } from "@agent-native/core/server";

import { CONTENT_LABS } from "../../shared/labs.js";

export default createLabsPlugin({
  labs: [...CONTENT_LABS, T3_CODE_AGENTS_LAB],
});
