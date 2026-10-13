import { registerSuggestionAdapter } from "@agent-native/core/review";

import { contentDocumentSuggestionAdapter } from "../lib/suggested-edits.js";

export default function registerContentSuggestionAdapter() {
  registerSuggestionAdapter(contentDocumentSuggestionAdapter);
}
