---
"@agent-native/core": patch
"@agent-native/dispatch": patch
"@agent-native/toolkit": minor
---

Move the reusable ChatHistoryList and its stylesheet to the Toolkit chat-history entrypoint while preserving Core compatibility imports. Adopt it across first-party full-page chat sidebars, ship readable Toolkit source, and add generated-app guidance for selective app-owned UI customization.
