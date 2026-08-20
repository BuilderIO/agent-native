---
"@agent-native/core": patch
---

Let the Builder gateway engine run on an OAuth-only connection. The pre-run
credential gate required a `BUILDER_PRIVATE_KEY`/`BUILDER_PUBLIC_KEY` pair, so
a user connected through Builder OAuth alone had every turn rejected with "No
LLM provider is connected" while the connect card reported them connected.
