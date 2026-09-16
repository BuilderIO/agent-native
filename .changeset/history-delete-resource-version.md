---
"@agent-native/core": patch
---

Add a `delete-resource-version` action, `deleteResourceVersionById` store
function, and `useDeleteResourceVersion` client hook so apps using the
reusable version-history kit can permanently remove one snapshot instead of
only creating, listing, reading, and restoring them.
