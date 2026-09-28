---
"@agent-native/core": minor
---

Add one S3-compatible file storage form (`StorageSettingsForm`) used by Settings, the onboarding checklist, and templates, backed by the new `get-file-storage` and `manage-file-storage` actions. Saving and clearing storage now requires an organization owner or admin on the server, and Clear credentials asks for confirmation before it deletes every saved storage key. Onboarding steps can declare a `kind: "file-storage"` method, and upload providers that serve files without a public URL set `publicBaseUrlOptional: true`.
