---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Make shared-auth rollout failures fail closed while allowing an explicitly allowlisted operator to manage feature flags across deployments without a local organization. Clear stale Dispatch fallback errors after a successful direct load, and keep hosted chat restore controls local-only.
