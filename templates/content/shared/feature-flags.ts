import {
  defineFeatureFlag,
  defineFeatureFlags,
} from "@agent-native/core/feature-flags";

export const A2A_RECEIVER_OWNERSHIP_FLAG = defineFeatureFlag({
  key: "content.a2a-receiver-ownership",
  displayName: "A2A receiver ownership",
  description:
    "Prefer Content's declared local capabilities when another app delegates an objective to Content.",
});

export const BUILDER_BODY_HYDRATION_REASONS_FLAG = defineFeatureFlag({
  key: "content.builder-body-hydration-reasons",
  displayName: "Builder body hydration reasons",
  description:
    "Classify Builder body reads, accept confirmed empty bodies, and retain actionable terminal evidence.",
});

export const CONTENT_FEATURE_FLAGS = defineFeatureFlags([
  A2A_RECEIVER_OWNERSHIP_FLAG,
  BUILDER_BODY_HYDRATION_REASONS_FLAG,
]);
