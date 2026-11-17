---
"@agent-native/toolkit": patch
---

`AppProviders` keeps the theme preference under the app's own storage key, which an optional `themeStorageKey` prop can override. The error boundary reads the same key. Credential save, rotate and connect actions use the host theme's primary colors, so their labels stay readable in both light and dark themes.
