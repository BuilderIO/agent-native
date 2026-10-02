---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Exclude test identities from metrics and non-auth email on every deployment through one rule, `isTestIdentity` (reserved `.test`/`.invalid`/`.localhost`/`.example` domains, the `+autoz` QA marker, and `AGENT_NATIVE_TEST_IDENTITY_EMAILS`). `sendEmail()` now returns `{ status: "sent" | "suppressed" }`; auth mail passes `authCritical: true` and still reaches test identities.
