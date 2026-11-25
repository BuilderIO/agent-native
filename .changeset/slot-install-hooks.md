---
"@agent-native/toolkit": patch
---

`@agent-native/toolkit/app/extensions` exports `useSlotInstalls`, `useSlotExtensions` and `useSlotInstallActions`, so an app can build its own menu for adding and removing widgets in a slot. `ExtensionSlot` uses the same hooks, and a widget added or removed through either updates both right away.
