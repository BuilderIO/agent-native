---
"@agent-native/core": patch
---

Reorder agent-engine resolution so a Builder-connected user always wins over a stale settings row. Add `isStoredEngineUsableForRequest` so per-user `app_secrets` (Builder or BYOK) are recognized when deciding whether a stored engine is usable, and update `/agent-engine/status` and the engine picker to honor the same priority chain at request time.
