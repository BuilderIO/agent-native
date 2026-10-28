import { createFeatureFlagsPlugin } from "@agent-native/core/server";
import { FIRST_RUN_BUILDER_CREDITS_V2_FLAG } from "@agent-native/toolkit/app/onboarding/first-run-builder-credits-flag";

import { DESIGN_SYSTEM_WORKFLOWS } from "../../shared/design-flags.js";

export default createFeatureFlagsPlugin({
  flags: [DESIGN_SYSTEM_WORKFLOWS, FIRST_RUN_BUILDER_CREDITS_V2_FLAG],
});
