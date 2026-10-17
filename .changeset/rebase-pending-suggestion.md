---
"@agent-native/core": patch
---

Add `rebaseSuggestion` to `@agent-native/core/review`. It moves a pending suggestion onto a new base revision, with operations that make the same change there, for example after the resource was rewritten into an equivalent form. The move is recorded as an amendment, so the suggestion's revision changes and anyone holding the old revision has to refresh before deciding.
