---
"@agent-native/core": minor
---

Add `getAdditionalSession`, `getAdditionalBrowserSession` and `clearAdditionalSession` auth options: an extra identity source consulted before the built-in sessions that, unlike `getSession`, does not replace them. A request the provider does not recognize resolves as it would without it, and the built-in sign-in routes stay mounted. A provider that throws refuses the request (503) rather than falling through to another identity, and an explicit bearer credential outranks the cookie provider. `clearAdditionalSession` runs on sign-out and sign-out of all sessions. The additional identity hooks are ignored when `getSession` is configured, because it takes over every session.

The delegated Builder credential hook (`registerDelegatedBuilderCredentials`) may now return a promise, so hosts on serverless can keep the credential in shared storage. It can answer `"none"` for a host-managed user with no credential, which stops every fallback (including deployment and gateway credentials), and a thrown error is a failed lookup.
