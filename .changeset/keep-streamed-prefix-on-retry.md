---
"@agent-native/core": patch
---

Stop duplicating an assistant reply when the model stream fails partway through. A failed call that already showed text is no longer restarted from scratch; it resumes from the streamed prefix, which stays on screen and is sent to the model as context. A run that still fails after showing text keeps that text above the error.
