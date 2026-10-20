import { createLabsPlugin } from "@agent-native/core/server";
import { CREATIVE_CONTEXT_LIBRARY_LAB } from "@agent-native/creative-context";

import { ANALYTICS_SESSIONS_TRIAGE_LAB } from "../../shared/labs.js";

export default createLabsPlugin({
  labs: [CREATIVE_CONTEXT_LIBRARY_LAB, ANALYTICS_SESSIONS_TRIAGE_LAB],
});
