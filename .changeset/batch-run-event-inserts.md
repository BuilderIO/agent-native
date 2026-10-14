---
"@agent-native/core": patch
---

Save streamed agent run events in batches, so write tools no longer wait for hundreds of single-row inserts after the model finishes.
