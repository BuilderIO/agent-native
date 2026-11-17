---
"@agent-native/toolkit": patch
---

Settings: pages can be described as rows instead of a component (`defineSettingsPage({ sections })`), rendered by the new `SettingsSections` row renderer and its typed row schema, model and hooks from `@agent-native/toolkit/app/settings`. `SettingsSectionsRendererProvider` lets an app replace the row markup while rows, writes and disabled state stay in the model. The shell exports `SkillsSettingsPage`, `SettingsShellProvider` and `SchemaSettingsPageDefinition`, and the settings index exports `ConnectionsSettingsContent`. A deep link to one half of an OAuth client ID/secret pair also shows the other half, and opens the secret when the ID is already saved.
