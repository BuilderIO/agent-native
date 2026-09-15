---
"@agent-native/core": patch
---

Keep Builder design-system indexing working for workspaces connected through Builder OAuth. Builder's `/design-systems/v1` routes still reject OAuth bearer tokens with `403 route_not_enabled`, so those calls now retry once with the workspace's Builder private key, and report an actionable failure naming the local `create-design-system` fallback when no key exists.
