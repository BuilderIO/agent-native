---
"@agent-native/core": patch
---

Organization invitations now report `emailSent: false` with an `emailError` when the email provider does not deliver the message, instead of always claiming it was sent.
