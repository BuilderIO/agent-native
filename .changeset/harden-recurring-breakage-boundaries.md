---
"@agent-native/core": patch
"@agent-native/toolkit": patch
"@agent-native/dispatch": patch
"@agent-native/skills": patch
---

Harden the boundaries behind the most-reported breakage. A closed chat stream now asks the server for the run's real state before the UI shows an outcome, and a user message sent during an active run waits instead of erroring. Sign-in state is one shared fact with one navigator, so reloads no longer flash to sign-in. Credential state is one typed value, so the credits banner and chat errors agree and activation can no longer replace an organization's Builder connection. Attachments resolve through one typed reference. Background automations record their real failure cause and pause after repeated identical failures instead of re-failing every tick. Error capture classifies and aggregates floods, groups one error into one issue, and filters third-party noise at one boundary. Tool-call errors keep a redacted reason, and human-in-the-loop pauses are no longer counted as errors. Expected action failures are typed 4xx responses, action hooks back off and stop on terminal errors, and a guard rejects new bare `throw new Error(...)` in actions. The shared command menu opens from the focused agent composer.
