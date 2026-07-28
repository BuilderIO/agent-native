---
"@agent-native/core": patch
---

Fix the model picker offering a model the app cannot route, and the chat bridge dropping submitted model overrides.

- The picker now defaults only to a configured engine group, and shows nothing when none is configured. `DEFAULT_MODEL` is a builder-gateway id that no group carries unless Builder is connected, so the old `?? DEFAULT_MODEL` / `?? groups[0]` fallbacks produced a selection the server silently replaced with its own default.
- A submitted `model`/`engine` pair is now applied regardless of whether the engine list has loaded, travels with cold-start queued sends, keeps the sender's engine, and treats a blank engine as absent. Previously it was honored only when the model already appeared in the (initially empty) engine list, so app-initiated first turns lost it.
- `[agent-chat] resolved …` now logs `requestModel` and `turnId`, making a server-side model substitution visible.
