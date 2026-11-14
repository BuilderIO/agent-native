import { defineFeatureFlag } from "@agent-native/core/feature-flags/registry";
import { FIRST_RUN_BUILDER_CREDITS_V2_FLAG_KEY } from "@agent-native/core/shared";

export const FIRST_RUN_BUILDER_CREDITS_V2_FLAG = defineFeatureFlag({
  key: FIRST_RUN_BUILDER_CREDITS_V2_FLAG_KEY,
  displayName: "First-run Builder credits v2",
  description:
    "Enable the account-assigned v2 credits flow across Design, Slides, and Clips.",
});
