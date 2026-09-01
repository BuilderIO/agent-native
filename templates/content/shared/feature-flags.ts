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

export const CONTENT_COMMENTS_UI_CLEANUP_FLAG = defineFeatureFlag({
  key: "content.comments-ui-cleanup",
  displayName: "Content comments UI cleanup",
  description:
    "Enable cleaner comment threads, persistent inline indicators, and comment keyboard shortcuts.",
});

export const CONTENT_FEATURE_FLAGS = defineFeatureFlags([
  A2A_RECEIVER_OWNERSHIP_FLAG,
  CONTENT_COMMENTS_UI_CLEANUP_FLAG,
]);
