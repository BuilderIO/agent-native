---
"@agent-native/core": minor
"@agent-native/toolkit": patch
---

`useCollaborativeDoc` returns `flushUpdates()`, which resolves once every local edit has reached the server (or `false` when delivery failed), so a caller that also saves the same edit to SQL can send it through the document first and peers never apply the text twice. `SharedRichEditor` accepts `requestInitialSeed` and `onInitialSeedError`, so an editor that is not Content's can have the server seed an empty live document once instead of every client seeding its own copy.
