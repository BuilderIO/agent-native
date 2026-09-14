import { createLabsPlugin } from "@agent-native/core/server";

import { DESIGN_LABS } from "../../shared/labs.js";

export default createLabsPlugin({ labs: DESIGN_LABS });
