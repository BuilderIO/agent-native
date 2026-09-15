---
"@agent-native/dispatch": patch
---

Keep the Apps page readable when the hosted workspace registry denies a read. A gateway 401/403 now falls back to the deployment-owned app manifest, which is still access-filtered per caller, and only throws when no source can answer the registry at all.
