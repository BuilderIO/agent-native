import { registerSuggestionAdapter } from "@agent-native/core/review";

import { contentBlocksFieldSuggestionAdapter } from "../lib/blocks-field-suggestions.js";
import { contentDocumentSuggestionAdapter } from "../lib/suggested-edits.js";

export default function registerContentSuggestionAdapter() {
  registerSuggestionAdapter(contentDocumentSuggestionAdapter);
  registerSuggestionAdapter(contentBlocksFieldSuggestionAdapter);
}
