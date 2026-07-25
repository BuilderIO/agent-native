---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Fix existing users being stranded in their personal workspace instead of their company org.

Request-time domain auto-join decided whether a user was still in a default workspace by
comparing the workspace name to a name recomputed from the current session. Sessions minted
by the framework's own Google OAuth and identity-SSO paths carry no display name while Better
Auth sessions do, so the same account could match on one sign-in path and not another — and a
renamed workspace, a changed provider display name, or any second org membership disabled the
auto-join permanently. It now keys off whether the user already belongs to an org whose
`allowed_domain` matches their email domain, which is the durable signal.

Joining is now also separated from activating: the company org is always joined, but the user
is only switched into it when their current workspace is one they solely own. Members of a
shared team stay where they are.

Also fixes two recovery paths that hid the manual way in: Settings → Team now shows the
"Join your team" card even when the user already has a (personal) workspace, and the Dispatch
sidebar keeps an icon-only workspace switcher when collapsed instead of dropping it.
