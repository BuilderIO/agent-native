---
"@agent-native/core": patch
---

Organization invites now report `emailSent: false` with an `emailError` when the invitation email was suppressed instead of delivered, so the invite form no longer claims a message was sent.
