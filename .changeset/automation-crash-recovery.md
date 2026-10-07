---
"@agent-native/core": patch
---

Recover interrupted scheduled automations from their worker heartbeat on scheduler ticks, resume unfinished steps in the same durable turn, and preserve journal-confirmed side effects in failure messages.

Bind recovery to an app-scoped firing history, stop dispatch after scheduler lease loss, retain recovery until history writes are durable, and fail closed on corrupt run journals.

Preserve interrupted firings during temporary identity lookup failures, settle permanent identity rejection with confirmed delivery evidence, and retain manual-run scheduling and pause policy during recovery.

Keep interrupted firings retryable when the scheduler loses its lease during setup, and release any unstarted successor before retrying the same turn.

Synchronize packaged Factory feedback guidance with its canonical skill.

Atomically link and claim automation workers after saving their original instructions, settle lease loss before a firing starts, recover manual firings without schedules, and report uncertain response delivery without resending it.

Clear an earlier scheduler firing's recovery identity when admitting an event or webhook run, so its history cannot settle the new firing.

Commit new firing history and its running marker together, honor live queued dispatch claims during setup and settlement, and restrict legacy scheduler recovery to scheduled trigger markers.

Keep newly admitted firings retryable after pre-start lease loss and reconcile terminal history independently of worker retention, preserving its recorded delivery evidence.
