---
"@agent-native/core": patch
---

Workspace invitations no longer report the email as sent when it was not. `emailSent` is true only when the email transport accepted the message; a suppressed send, or a deployment with no email delivery configured, now returns `emailSent: false` with an `emailError`, so the invite form says the invitation was saved instead of claiming it was emailed. `sendOrgInvitationEmail` now returns the transport result.
