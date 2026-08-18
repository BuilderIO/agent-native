import { createFeatureFlagsPlugin } from "@agent-native/core/server";

import { FULL_APP_BUILDING } from "../../shared/full-app.js";

export default createFeatureFlagsPlugin({ flags: [FULL_APP_BUILDING] });
