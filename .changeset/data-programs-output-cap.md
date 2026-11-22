---
"@agent-native/core": patch
---

Let data programs emit their documented 4 MiB result in background runs and in the production sandbox, and report a cut-off result as result_too_large instead of a parse error.
