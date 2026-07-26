---
"@agent-native/core": patch
---

Give headless agent runs the same recovery the chat surface has, and keep a
deliberate stop from being auto-restarted. Scheduled jobs, automation triggers,
messaging-integration turns, and Google Docs comment replies now run through the
resume wrapper instead of calling the agent loop raw, so a transport-level cut
(gateway timeout, socket hang up, upstream 5xx) is resumed inside the same
invocation rather than silently losing the run. Job runs are marked as
background dispatch so the stale reaper stops reaping them mid-flight against a
window sized for a browser-streamed foreground run, and a job that ended at a
continuation boundary is recorded as an error instead of shipping its truncated
partial answer as a success. Recovery aborts that are neither a user stop nor a
continuation boundary (a Slack cancel, a stuck-banner auto-retry) now surface
their real reason without the client auto-continuing the work someone just
stopped.
