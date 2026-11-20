---
"@agent-native/core": patch
---

Durable background chat runs now carry a signed copy of the initiator they resume as, and the worker refuses to start when the stored initiator differs from it or when that person is no longer a member of the run's organization.
