---
"@agent-native/core": patch
---

Fix `mergeThreadDataForClientSave` pairing two structurally identical messages (same role/content/attachments, different ids) by whichever incoming entry a content fingerprint happened to hit first. A strong identity key (id/runId/turnId) now always wins over a fingerprint-only match, and a fingerprint tie is resolved deterministically by array position instead of silently keeping the first candidate — a wrong pairing could rewrite parent links onto the wrong message id.
