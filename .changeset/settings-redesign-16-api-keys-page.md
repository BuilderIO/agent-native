---
"@agent-native/core": minor
---

With the `settings-redesign` flag on, Settings › API keys shows Your keys (each "{mask} · Used by {feature}"), Organization keys for owners and admins, and Managed by integrations (collapsed behind "Show N keys"; read-only, each linking to the page that owns it, with calendar tokens only while Meetings is on). A model provider key's Manage opens the provider dialog; other keys offer Test, Replace value, and Delete key. Add key takes a name, value, and who can use it (members are locked to Just me). Delete key lists what stops, per app and feature, before it deletes.

- New read-only action `list-api-keys`: every saved key the credential resolver can use for the caller, including legacy `solo:<email>` and organization `workspace` rows, with its mask, what uses it, its model provider, its owner page when another page manages it, and whether the caller can replace, delete, or test it. Members never see organization keys, and managed organization keys list without a mask. It also lists registered keys nobody has saved yet.
- New action `delete-api-key { name, scope, storedScope }` deletes exactly one listed row. It refuses managed and Vault-synced keys, needs an owner or admin for organization keys, is audited, and fails with 404 when nothing was removed.
- New client helpers `saveApiKeyValue` and `testSavedApiKey` wrap the secrets routes, so key values never pass through an action.
- Automation webhook signing secrets (`automation-webhook:*`) are now managed by Automations, so API keys lists them read-only and the secrets delete routes refuse them. The storage manager's route is now `infra`, the Infrastructure page id.
- The voice input settings link to a missing key opens Settings › API keys instead of Integrations. A model provider key (Gemini, OpenAI, Groq) opens the provider dialog for that provider; any other key opens Add key with its name.
