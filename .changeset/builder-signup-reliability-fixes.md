---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Fixes automatic Builder.io account setup reliability across signup paths: a cold-start request to the Builder signup route now waits for the route instead of falling through, and signup callbacks during bootstrap no longer skip setup; Google signup from the login view and mobile/desktop Google exchanges are enrolled; cross-browser magic-link signups keep consent through a single-use landing disclosure; first-run onboarding sends users with an existing Builder account straight to sign-in; and provisioning failures keep a stable `provision_failed` code.
