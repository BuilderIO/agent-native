import { createFeatureFlagsPlugin } from "@agent-native/core/server";

import { CONTENT_FEATURE_FLAGS } from "../../shared/feature-flags.js";

export default createFeatureFlagsPlugin({ flags: CONTENT_FEATURE_FLAGS });
