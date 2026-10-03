---
"@agent-native/core": patch
---

Flagged test-identity exceptions now carry the matched address as `test_identity_email`, so Agent-Native Analytics ingest can verify the identity instead of trusting a sender-set `test_identity` flag.
