---
"@agent-native/core": patch
---

Keep hosted template server shells CDN-cacheable by applying the shared SSR SWR
headers to auth login HTML and always enforcing SSR cache headers on React
Router shell/data responses.
