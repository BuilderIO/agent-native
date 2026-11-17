---
"@agent-native/core": patch
---

A visual-edit design capability can now build its own board (create, update and rename screens, update design data, apply tweaks) and nothing else, from one explicit, tested allowlist. `clearEmbedAuthToken()` from `@agent-native/core/client/host` drops a tab's embed credential once the tab signs in to an account. The remix and visual-edit skills build a remix board signed out and ask for sign-in only to share or save it.
