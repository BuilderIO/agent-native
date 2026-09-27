---
"@agent-native/core": minor
---

Add the redesigned Settings shell behind the `settings-redesign` feature flag: a page registry (`defineSettingsPage`, `registerSettingsPages`, `SETTINGS_PAGE_IDS`), Account, Connections, Agent, Organization, and app groups with role-gated pages, search, a sticky header, and a mobile drawer. `SettingsTabsPage` waits for the flag behind a layout-matching skeleton and bridges today's props and tabs into the new pages, so templates keep working unchanged. Also adds `useFeatureFlagState`, which tells a flag that is still loading apart from one that evaluated off.
