---
"@agent-native/core": patch
---

Fix rich-text editing data loss in the shared collab reconcile. The reconcile now
remembers a small bounded ring of recent local emissions, so a stale-but-recent
poll echo — e.g. a debounced autosave that persisted only a partial burst, then
re-supplied by the next poll with a newer timestamp — can no longer clobber the
freshly-typed tail. Previously only the single latest emission was recognized as
an echo, so the trailing characters typed during the save→poll window were
reverted. External (agent/peer) edits never byte-match a local emission, so
agent resync is unaffected.
