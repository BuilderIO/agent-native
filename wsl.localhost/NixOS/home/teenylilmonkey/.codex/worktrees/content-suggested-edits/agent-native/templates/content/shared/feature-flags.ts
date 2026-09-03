import { defineFeatureFlag, defineFeatureFlags } from "@agent-native/core/feature-flags";

export const CONTENT_SUGGESTED_EDITS_FLAG = defineFeatureFlag({
  key: "content.suggested-edits",
  displayName: "Content suggested edits",
  description: "Allow authorized collaborators and agents to propose page-body edits for review.",
});

export const CONTENT_FEATURE_FLAGS = defineFeatureFlags([
  CONTENT_SUGGESTED_EDITS_FLAG,
]);
