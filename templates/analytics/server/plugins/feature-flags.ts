import { createFeatureFlagsPlugin } from "@agent-native/core/server";

import { ANALYTICS_FEATURE_FLAGS } from "../../shared/feature-flags.js";

export default createFeatureFlagsPlugin({ flags: ANALYTICS_FEATURE_FLAGS });
