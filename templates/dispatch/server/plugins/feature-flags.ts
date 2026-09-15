import { createFeatureFlagsPlugin } from "@agent-native/core/server";

import { DISPATCH_FEATURE_FLAGS } from "../../shared/feature-flags.js";

export default createFeatureFlagsPlugin({ flags: DISPATCH_FEATURE_FLAGS });
