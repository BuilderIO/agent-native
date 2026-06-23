---
"@agent-native/core": minor
---

Add an in-app changelog ("What's new") surface. Every app can now ship a
user-facing `CHANGELOG.md` that renders in the command menu (Cmd+K) and in
settings. Core provides `<ChangelogDialog>`, `<ChangelogSettingsCard>`, a
`changelog` prop on `CommandMenu` (with an unseen-release dot), and an
`agent-native changelog add|release|list` CLI that authors changeset-style
pending entry files and rolls them up into the dated `CHANGELOG.md`.
