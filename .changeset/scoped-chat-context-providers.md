---
"@agent-native/core": patch
---

Expose per-thread composer context providers so apps can share their reference and integration menus across home, sidebar, and full-page chat while revalidating captured context before submission. Preserve bounded, identity-scoped selection metadata across surface handoffs and re-read reference content on remount.
