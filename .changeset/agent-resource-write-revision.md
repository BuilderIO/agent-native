---
"@agent-native/core": minor
"@agent-native/toolkit": patch
---

The agent's resource writes can now refuse to write over a newer save. An agent's resource read starts with a `[revision …, scope …]` line, and the `resources` write action, `write-resource` and `pnpm action resource-write --expected-revision` take that revision back: when someone saved the file after the read, nothing is written and the write fails with `save_conflict` and the revision there now. Writes report the new revision, and a write without one still replaces what's there. `POST /_agent-native/resources` returns the `revision` too, `useCreateResource` accepts `ifNotExists`, and `resourcePutIfSnapshot` takes `visibility`, `threadId`, `runId` and `expiresAt`. Toolkit's personalization settings save their instructions over the version each edit started from, merging onto a newer save and asking which version to keep when both changed the text.
