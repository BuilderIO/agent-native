---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Fixes automatic Builder.io account setup reliability across signup paths: mounts the Builder signup experiment route before deferred framework bootstrap finishes, wires Google signup enrollment from `/login` and mobile/desktop OAuth exchanges, supports cross-browser magic-link signup with explicit Builder Terms disclosure on the landing page, updates first-run onboarding to guide users with existing Builder accounts straight to sign-in, and preserves typed failure codes when Builder provisioning fails.
