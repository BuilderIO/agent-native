---
"@agent-native/core": patch
---

Dedupe the client export and server fold of the same tool-call turn so it no longer renders twice. Now that rebuilt tool-call ids are scoped by run (`${runId}:tc_1`) while the live client stream uses a bare counter (`tc_1`), the two copies of one turn hashed to different thread-merge fingerprints; the render-only `toolCallId` is now stripped before fingerprinting so they match again.
