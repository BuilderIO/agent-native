---
"@agent-native/toolkit": patch
---

Settings: `navFooter` pins content under the settings nav, `defaultPage` picks the page for a bare `/settings`, pages can be `unlisted` or own their `nestedRoutes`, and a page's header badge renders inside its title. `saveApiKeyValue` and `removeApiKeyValue` are exported. `ShareButton` adds `stagedInvites` (email chips shared together), `roleMenu` (a per-person role menu with Remove), and `invitePlaceholder`. `CommandMenu` accepts `settingsShortcutHint`. The editor exports `createListItemWidgets`. The composer adds `enterSubmitMode="plain"`, `ComposerEnterKeyContext` for Enter-inserts-newline hosts, opt-in `richTextEnabled` with `textBlockSeparator`, measures the model menu's room on every open, and shows a readiness-check failure while keeping the typed question for retry. Chat hosts can pass `composerAttachmentsEnabled`, `showContextPicker`, `emptyStateSuggestionsLayout` and `renderEmptyStateSuggestion`.
