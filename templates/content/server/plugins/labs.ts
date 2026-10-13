import { createLabsPlugin } from "@agent-native/core/server";

import { CONTENT_LABS } from "../../shared/labs.js";

export default createLabsPlugin({ labs: CONTENT_LABS });
