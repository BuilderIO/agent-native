---
"@agent-native/core": patch
---

Fix background chat runs with image attachments failing with `submission_payload_attachments_mismatch`: the worker no longer re-checks client attachment fingerprints against the sanitized durable dispatch payload.
