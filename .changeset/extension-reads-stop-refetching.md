---
"@agent-native/core": patch
---

Stop `get-extension` from re-fetching source the agent already holds. Identical `contentQuery` excerpts are now deduplicated per run the same way whole-body reads already were — one production turn spent 48 of its 110 extension reads re-sending spans it had just been given. The large-body hint also now says when a single `forceContent` read costs less context than repeated excerpts.
