---
"@agent-native/core": patch
---

Defer non-visible startup reads past first paint and gate pre-auth localization calls. Adds an opt-in `useAfterPaint`/`scheduleAfterPaint` client primitive and adopts it at the agent-engine status, MCP servers, Builder status, onboarding, and slot-install mount points. The onboarding dialog's three mount reads (`steps`, `dismissed`, `profile`) compose into one `/_agent-native/onboarding/summary` request, and the localization preference read plus the localization app-state write no longer fire without a session, which removes the signed-out 401 console errors on first visits.
