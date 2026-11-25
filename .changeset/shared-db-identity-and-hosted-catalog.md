---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Fix email change in multi-app workspaces: Dispatch's identity policies now ship in core, so any app sharing the database can rekey. Workspace apps no longer answer 503 `org-domain-missing` for an org without an allowed domain; the registry token names the org by id instead. Add `setupDispatch({ hostedCatalog: false })` to hide Builder-hosted apps from Dispatch lists.
