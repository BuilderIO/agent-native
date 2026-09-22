---
"@agent-native/core": patch
---

Ship react-dom, react-router, and @tanstack/react-query alongside the external React runtime required by serverless SSR chunks, so the deployed function and the prebuilt route chunks resolve one shared instance of each instead of two.
