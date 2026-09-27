---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Settings polish follow-ups:

- `@agent-native/core/client/settings` now exports `KeyValueDialog` (with `KeyValueDialogMode` and `KeyValueDialogProps`) and the `ApiKeyEntry` and `ApiKeysListing` types, so an app page can add or replace a key in place instead of sending people to Settings › API keys.
- `NewKeyMenu` takes `size` (`xs`, `sm`, or `default`) and `variant` props and no longer restyles its trigger; `triggerClassName` is for layout only. The default is `xs` secondary, the group heading action size. The sub-agent dialog's credential picker uses the dialog control size, and the Dispatch Vault's New button uses `size="default"` instead of size classes.
- The custom integration dialog shows "Connecting…" and "Testing…" beside the spinner while a connect or test runs.
- Removed catalog keys that nothing reads anymore: `agentChat.settings.storage.missing`, `agentChat.settings.storage.missingPublicUrl`, `agentChat.settingsOrg.invite.close`, `agentChat.settingsShell.account.newEmailPlaceholder`, and `agentChat.settingsSubAgents.browseDirectory`.
