---
"@agent-native/core": patch
---

Make full settings pages consistent and polished. Framework settings sections (Agent, Connections, Workspace) now render as shadcn-style cards with roomy, surface-aware form controls on the settings page while staying compact in the agent sidebar, and the shared section bodies scale their dense type up to a comfortable, uniform reading size on the page. `SettingsTabsPage` also ships a built-in, on-by-default settings search that deep-links to sections across tabs via `SettingsSearchEntry`.
