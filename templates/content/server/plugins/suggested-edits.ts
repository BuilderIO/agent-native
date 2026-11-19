import {
  registerReviewableResource,
  registerSuggestionAdapter,
} from "@agent-native/core/review";

import { contentBlocksFieldSuggestionAdapter } from "../lib/blocks-field-suggestions.js";
import { contentDocumentReviewResource } from "../lib/document-review-access.js";
import { contentDocumentSuggestionAdapter } from "../lib/suggested-edits.js";

export default function registerContentSuggestionAdapter() {
  registerSuggestionAdapter(contentDocumentSuggestionAdapter);
  registerSuggestionAdapter(contentBlocksFieldSuggestionAdapter);
  registerReviewableResource(contentDocumentReviewResource);
}
