import { createFeatureFlagsPlugin } from "@agent-native/core/server";
import { FIRST_RUN_BUILDER_CREDITS_V2_FLAG } from "@agent-native/toolkit/app/onboarding/first-run-builder-credits-flag";

import {
  DESIGN_REVIEW_PANEL,
  DESIGN_SYSTEM_WORKFLOWS,
} from "../../shared/design-flags.js";
import { FULL_APP_BUILDING } from "../../shared/full-app.js";

export default createFeatureFlagsPlugin({
  flags: [
    FULL_APP_BUILDING,
    DESIGN_REVIEW_PANEL,
    DESIGN_SYSTEM_WORKFLOWS,
    FIRST_RUN_BUILDER_CREDITS_V2_FLAG,
  ],
});
