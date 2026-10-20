---
"@agent-native/core": minor
"@agent-native/dispatch": patch
"@agent-native/scheduling": patch
---

Require approval for `needsApproval` actions on every surface. HTTP action routes and generated Workers entries now run an approval-gated call only for the signed-in app UI (or its MCP directory widget); a bearer token, MCP OAuth token, org service token, A2A peer, or other HTTP caller gets `409 approval_required`, and an unproven browser call gets `403 ui_capability_required`. The app's client now presents its UI capability with every write from a signed-in session, so the 403 and one retry are only the fallback for an expired or rejected capability. `revoke-org-service-token` and the credential, membership, and app-access actions in core, Dispatch, and Scheduling now ask for approval on every call, with "always allow" off.
