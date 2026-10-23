---
"@agent-native/core": patch
---

A run that finishes no longer marks itself aborted as "displaced" when the periodic abort check reads its own completed status mid-finalization. Delegated A2A calls no longer report a successful specialist run as "aborted before completion".
