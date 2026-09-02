---
"@agent-native/core": patch
---

Make `detectEngineFromUserSecrets` batch-load candidate provider credentials
in one read per identity scope instead of sweeping the whole engine registry
one point read at a time. An unconfigured request (e.g. the polled
`/_agent-native/agent-engine/status` gate in local dev) previously issued ~80
sequential `app_secrets` reads per call; it now reuses the existing
`prefetchSecrets` memo so the per-engine usability checks answer from the
request cache. Same precedence, identity scoping, and unreadable-store
propagation.
