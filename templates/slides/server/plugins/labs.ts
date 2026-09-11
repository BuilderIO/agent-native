import { createLabsPlugin } from "@agent-native/core/server";

import { SLIDES_LABS } from "../../shared/labs.js";

export default createLabsPlugin({ labs: SLIDES_LABS });
