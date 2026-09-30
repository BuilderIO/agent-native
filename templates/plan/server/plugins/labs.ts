import { createLabsPlugin } from "@agent-native/core/server";

import { PLAN_LABS } from "../../shared/labs.js";

export default createLabsPlugin({ labs: PLAN_LABS });
