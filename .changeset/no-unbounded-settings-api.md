---
"@agent-native/core": major
---

Remove `getAllSettings()` and `listSettingsByKeySegments()`; use `getSetting()` or `getSettings(keys)` when the required keys are known. Remove `CollabPluginOptions.resolveCollabDocumentId` and its whole-table lazy-seed lookup; use `resolveSourceIdFromCollabDocumentId` to map a collaboration document id to its keyed source row. These exported APIs are removed because they require table-wide reads.
