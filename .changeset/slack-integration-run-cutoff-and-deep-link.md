---
"@agent-native/core": patch
---

Fix messaging-integration (Slack) runs that answered "The model finished without a visible answer" and whose **Open thread** button landed on an empty Dispatch chat.

- **Research-shaped asks no longer die at 40s.** `processIntegrationTask` hardcoded the 40s foreground soft-timeout even when durable dispatch had routed the task to the emitted Netlify `-background` function (~15min budget). Any multi-source request — sweep Gong, HubSpot, a Slack channel and Pylon, then summarize — was aborted at a continuation boundary with no user-facing text. The run now takes the background ceiling when `isInBackgroundFunctionRuntime()` proves it is inside that function, so the ~60s synchronous wall still governs everywhere it actually applies.
- **A cut-off run says so.** A run that stops at an `auto_continue` boundary is no longer reported as a model that answered with nothing; it now says it ran out of time, points at the thread for the work it did gather, and suggests asking in smaller pieces.
- **The Open thread deep link resolves.** A channel conversation runs as the integration service principal, so its thread is owned by `integration@<platform>` and the deep link 404'd for the human who asked — Dispatch silently rendered a brand-new empty chat instead. Each verified participant is now granted an explicit editor share on the thread they are driving (`grantThreadUserShare`, idempotent and never downgrading an existing stronger role), so the button opens the real conversation and it appears in their Dispatch history.
