---
"@agent-native/dispatch": patch
---

Setting a Builder project in Dispatch now enables cloud code changes for that organization's workspace apps. The project id is stored as an organization-scoped credential, which is what `resolveBuilderBranchProjectId()` actually reads — previously it was saved only to Dispatch's own settings row, so apps kept reporting code changes as unavailable. Clearing the project removes the credential and returns those apps to the connect prompt.
