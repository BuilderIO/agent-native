import { registerReviewableResource } from "@agent-native/core/review";

import { CONTENT_SUGGESTED_EDITS_FLAG } from "../../shared/feature-flags.js";
import { assertSuggestedEditTarget, applySuggestedEdit } from "../lib/suggested-edits.js";

/** Registers Content's page-body adapter once Core's executable suggestion API is available. */
export default async function suggestedEditsPlugin() {
  registerReviewableResource({
    resourceType: "document",
    featureFlag: CONTENT_SUGGESTED_EDITS_FLAG.key,
    adapter: { assertTarget: assertSuggestedEditTarget, apply: applySuggestedEdit },
  } as never);
}
