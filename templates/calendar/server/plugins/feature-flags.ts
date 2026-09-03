import { createFeatureFlagsPlugin } from "@agent-native/core/server";

import { SHARED_GOOGLE_CALENDARS } from "../../shared/feature-flags.js";

export default createFeatureFlagsPlugin({ flags: [SHARED_GOOGLE_CALENDARS] });
