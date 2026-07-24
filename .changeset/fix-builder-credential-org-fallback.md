---
"@agent-native/core": patch
---

Resolve Builder credentials through an email-based org fallback and a solo-workspace fallback so a transient org-context dropout no longer reports a connected Builder account as "not configured", and surface credential-store read failures as retryable.
