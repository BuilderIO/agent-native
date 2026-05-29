---
"@agent-native/core": minor
---

Make the agent a real-time peer editor on collaborative documents. Add `isReconcileLeadClient(awareness, clientId)` so exactly one connected client applies an authoritative external snapshot (agent edit, Notion pull, full rewrite) into a shared Y.Doc — the rest receive it through normal Yjs sync — preventing the changed region from being duplicated across clients. Editors now reconcile newer SQL content into the live Y.Doc gated on `updatedAt`, so a lagging poll can never revert live edits and post-refresh content is always correct.
