---
"@agent-native/core": patch
---

Let a workspace without an email domain call other apps over A2A. A workspace linked through the identity hub names itself by its shared `(identity_authority, identity_id)`; the receiving app binds that pair to its own organization and confirms the caller is a current member with the hub, recording the membership when it has not seen the caller before. A workspace with neither a domain nor a linked identity now fails with a clear `a2a_caller_org_domain_missing` message instead of an unexplained 401. Takes effect only while `organization.cross-app-federation` is on for the workspace.
