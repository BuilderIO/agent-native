---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Exclude test identities from metrics and non-auth email on every deployment through one rule, `isTestIdentity` (reserved `.test`/`.invalid`/`.localhost`/`.example` domains, the `+autoz` QA marker, and `AGENT_NATIVE_TEST_IDENTITY_EMAILS`). `sendEmail()` now returns `{ status: "sent" | "suppressed" }`; auth mail passes `authCritical: true` and still reaches test identities. Test identities are dropped from `to`, `cc`, and `bcc` alike (each logged), a real `cc` recipient stands in for a test-identity `to` (a `bcc` recipient never does), and a send left with no `to` or `cc` recipient is suppressed; `sendEmail()` now also delivers `bcc`. The `/_agent-native/auth/session` response now carries a server-resolved `testIdentity` boolean, so browser analytics, session replay, and exception capture skip configured identities too without the configured list reaching the browser.
