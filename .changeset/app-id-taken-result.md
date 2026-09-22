---
"@agent-native/dispatch": patch
---

Report a taken workspace app id as a typed `app-id-taken` result instead of an unhandled 500. `startWorkspaceAppCreation` checked for an id collision in two places — a cross-member guard and the reservation itself — and neither was inside a `try`, so the message each one built (naming the conflict and, for an in-flight creation, its owner) was replaced by a generic "Internal server error" in the create-app UI and in chat. Both collision paths now throw `WorkspaceAppIdTakenError`, the caller converts only that error into `{ mode: "app-id-taken", conflict, owner, message }`, and registry/storage failures keep propagating. `workspace-template-card` previously fell through to a success toast for any mode it did not recognize and now reports this one as an error.
