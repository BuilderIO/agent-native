---
"@agent-native/core": patch
---

Fix automations getting permanently stuck in the "Running" state and blocking
every future run with "The automation is already running. No delivery was
confirmed." The shared `lastStatus: running` lock is used by scheduled,
event-triggered, and manual-only automations alike, but the periodic sweep
that resets a stuck lock past the shared timeout only ever ran for
cron-scheduled automations. Event-triggered and manual-only automations (for
example a Slack automation with no cron schedule) fell through that
schedule-only skip and never got the automatic reset, so a crashed or
recycled worker left them locked indefinitely unless a matching event
happened to arrive or someone retried manually after the timeout window.

The sweep now runs for every automation resource on every scheduler tick,
regardless of trigger type, and no longer touches the automation's run
history when its own reset write loses a race to a concurrently-started run.
