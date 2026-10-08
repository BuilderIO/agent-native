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

Report post-commit notification and history-retention failures without aborting an already committed firing admission.

Recover from an absent or mismatched firing-history reference as an explicit error without replaying work or modifying unrelated history; retain scheduled backoff and manual-run policy.
Preserve completed no-op outcomes when reconciling recovery alongside the shared automation outcome runner, and keep its clock context in the saved request.

Retain unfinished firing history during pruning and recover journal-confirmed no-op results when terminal history persistence was interrupted.

Apply shared work-confirmation rules during recovery, settle missing worker evidence without replaying it, preserve unfinished scheduled firing references across trigger dispatch, and stop disabled scheduled firings while retaining intentional manual recovery and delivery evidence.
