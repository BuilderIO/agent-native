---
"@agent-native/core": patch
---

Fix an awareness "storm" in `useCollaborativeDoc`: the shared collab connection's fast awareness-push path re-broadcast a client's own (unchanged) presence state whenever ANY remote participant's awareness changed, not just when the local user actually moved their cursor or updated their presence. With several people collaborating on the same document, every peer's cursor move caused every other connected client to also re-POST its own state, multiplying awareness traffic roughly quadratically with participant count. The fast-push listener now only fires on locally-originated awareness changes (`origin === "local"`), matching the equivalent guard already present in `usePresence`.

Also add a defensive size cap to the collab `recentEdits` ring (`appendRecentEdit`): descriptor strings (`quote`, `selector`, path entries) and the edit `label` are now truncated to 500 characters. The ring was already bounded in length, but an app forgetting to trim its own excerpt before publishing (e.g. passing a whole paragraph or document as `quote`) could otherwise push an oversized payload through the awareness fast-path broadcast and into the `_collab_awareness` SQL mirror.
