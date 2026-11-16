---
"@agent-native/core": patch
---

Netlify workspace deploys now honor `AGENT_NATIVE_ENABLE_KEEP_WARM`: they emit one scheduled function that keeps every app's server function warm, and `AGENT_NATIVE_KEEP_WARM_CONCURRENCY` sets how many instances each app keeps warm, so opening a quiet app no longer cold-starts every request of its first page load.
