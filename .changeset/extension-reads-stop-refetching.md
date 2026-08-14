---
"@agent-native/core": patch
---

Stop `get-extension` from re-fetching source the agent already holds. Identical `contentQuery` excerpts are now deduplicated per run the same way whole-body reads already were — one production turn spent 48 of its 110 extension reads re-sending spans it had just been given. The inline read cap also rises from 60,000 to 200,000 characters, and the large-body hint now says when one `forceContent` read is cheaper than repeated excerpts, so a large extension no longer costs more context to read in fragments than to read whole.
