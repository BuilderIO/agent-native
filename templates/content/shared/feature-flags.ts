import { defineFeatureFlag } from "@agent-native/core/feature-flags/registry";

export const CONTENT_SUGGESTED_EDITS_FLAG = defineFeatureFlag({
  key: "content.suggested-edits",
  displayName: "Content suggested edits",
  description: "Allow authorized collaborators and agents to propose page-body edits for review.",
});

export const CONTENT_FEATURE_FLAGS = [CONTENT_SUGGESTED_EDITS_FLAG] as const;
