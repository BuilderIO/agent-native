import { createLabsPlugin } from "@agent-native/core/server";

import { CLIPS_LABS } from "../../shared/labs.js";

export default createLabsPlugin({ labs: CLIPS_LABS });
