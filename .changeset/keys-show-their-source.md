---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Settings → Integrations → Keys now reports the value each app actually uses and where it comes from (personal, workspace, Vault, or environment) instead of only the row it wrote itself, so keys synced from the Dispatch Vault no longer look unset. The "+ New" menu keeps a custom-key row visible and turns typed text into a custom key. The Dispatch Vault add/edit dialogs are key-first, and its access card explains how apps see Vault keys.
