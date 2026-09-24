---
"@agent-native/core": patch
---

Keep bring-your-own chat runtimes running past the periodic in-run save. The save no longer forces the live assistant message to complete, so external-runtime turns longer than five seconds stop reporting as stopped and their in-flight tool calls are no longer marked interrupted.
