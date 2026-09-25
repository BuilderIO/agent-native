---
"@agent-native/core": minor
---

Split Account into Profile, Preferences, and Security pages behind the `settings-redesign` flag. Profile has the photo, an inline name field, and a Change email dialog; Preferences has Interface language, Timezone, and the Voice transcription picker (moved off the Agent page); Security has Add or Change password and two-factor dialogs plus separate Request a copy and Request deletion rows. Every row has a search entry. `AccountSettingsCard` keeps working for the old Settings and now shares the pages' request logic. The compact voice picker now reports a failed read or save instead of showing Batch as the saved choice.
