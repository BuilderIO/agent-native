---
"@agent-native/core": patch
---

Allow collaboration persistence to enforce the source document's live lifecycle within the same transaction, and discard cached mutations when a write fails.

Quarantine client connections after terminal document lifecycle rejections so retries and remounts fetch authoritative state without replaying rejected edits.
