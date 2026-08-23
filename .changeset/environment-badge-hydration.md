---
"@agent-native/core": patch
---

Fix EnvironmentBadge causing a React hydration mismatch on public SSR pages by deferring its content to a post-mount effect instead of branching on `typeof window` during render.
