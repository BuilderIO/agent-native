---
"@agent-native/core": patch
---

Export `getSuggestionByCreationKey` so app-owned suggestion wrappers can resolve an existing idempotency receipt before rebuilding a proposal.