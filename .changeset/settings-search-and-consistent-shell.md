---
"@agent-native/core": minor
---

Revamp the shared settings shell (`SettingsTabsPage`): an edge-aligned,
independently scrolling left nav with consistent theming, a built-in settings
search that deep-links into tabs and sections via `searchEntries` /
`generalSearchEntries`, and a new controlled `value` / `onValueChange` mode so
apps can drive the active tab from their own routing and application state.
