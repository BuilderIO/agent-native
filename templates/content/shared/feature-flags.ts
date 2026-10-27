import {
  defineFeatureFlag,
  defineFeatureFlags,
} from "@agent-native/core/feature-flags/registry";

/**
 * Compare what the editor saves with the page body built from the live copy,
 * without changing what is saved. The flags panel shows the key: a display
 * name or description here would be untranslated operator copy.
 */
export const LIVE_BODY_SHADOW_FLAG = defineFeatureFlag({
  key: "content.live-body-shadow",
});

/**
 * Write switched pages' bodies through the live copy. It counts only together
 * with the shadow flag, so turning the shadow flag on to measure parity never
 * switches anyone; `server/lib/live-body-writer.ts` is the one evaluator.
 */
export const LIVE_BODY_WRITER_FLAG = defineFeatureFlag({
  key: "content.live-body-writer",
});

/**
 * Switch pages to their live copy without a manual switch: on an editor's
 * first open, and in the backfill sweep. It counts only together with the
 * other two, for the page's owner; `server/live-copy/backfill.ts` evaluates
 * it.
 */
export const LIVE_BODY_BACKFILL_FLAG = defineFeatureFlag({
  key: "content.live-body-backfill",
});

export const CONTENT_FEATURE_FLAGS = defineFeatureFlags([
  LIVE_BODY_SHADOW_FLAG,
  LIVE_BODY_WRITER_FLAG,
  LIVE_BODY_BACKFILL_FLAG,
]);
