import { createLabsPlugin } from "@agent-native/core/server";
import { CREATIVE_CONTEXT_LIBRARY_LAB } from "@agent-native/creative-context";

import { SLIDES_LABS } from "../../shared/labs.js";

export default createLabsPlugin({
  labs: [...SLIDES_LABS, CREATIVE_CONTEXT_LIBRARY_LAB],
});
