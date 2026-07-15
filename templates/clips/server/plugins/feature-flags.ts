import { createFeatureFlagsPlugin } from "@agent-native/core/server";

import { CLIPS_FEATURE_FLAGS } from "../../shared/feature-flags.js";

export default createFeatureFlagsPlugin({ flags: CLIPS_FEATURE_FLAGS });
