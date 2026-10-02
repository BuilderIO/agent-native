---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Exclude test identities from metrics and non-auth email on every deployment through one rule, `isTestIdentity` (reserved `.test`/`.invalid`/`.localhost`/`.example` domains, the `+autoz` QA marker, and `AGENT_NATIVE_TEST_IDENTITY_EMAILS`). `sendEmail()` now returns `{ status: "sent" | "suppressed" }`; auth mail passes `authCritical: true` and still reaches test identities. Test identities are dropped from `to`, `cc`, and `bcc` alike (each logged), and a send is suppressed only when no real recipient remains; `sendEmail()` now also delivers `bcc`.
