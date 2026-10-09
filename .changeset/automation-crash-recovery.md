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

Settle permanently unreadable journals with an unknown-delivery error while retrying database failures, preserve firing identity fences when timestamps are absent, and honor action metadata that excludes progress-only work from success.

Durably settle malformed no-op evidence as an explicit unknown-delivery error, restore no-op declarations from their original journal result, and prevent replayed no-op acknowledgements from counting as completed work.

Use the resource-scoped automation history ownership helper for atomic admission and recovery, preserving personal history when execution carries an organization context.

Settle ambiguous legacy firing markers as explicit unknown-evidence errors without choosing, finishing, or replaying either history, while retaining transient history-read failures for retry.

Preserve original tool argument identity with a SHA-256 fingerprint before stripping inline attachment bytes, fail closed for legacy redacted inputs without that identity, and include predecessor-confirmed work when settling resumed automation outcomes.

Associate tool receipts with their call IDs, retain ambiguous concurrent calls as unknown, and preserve every own JSON key in replay fingerprints.

Reject journal fingerprints that contradict their original arguments and require receipt arguments to agree with the matching call after byte stripping.

Snapshot fresh tool arguments before queued journal writes, store separate original and persisted argument digests, preserve every own JSON property during byte stripping, and leave ambiguous identical invocations unknown.

Keep start and completion journal events bound to the same pre-invocation arguments even when an action mutates its input.

Honor explicit successful tool outcomes during replay classification without interpreting arbitrary result text as a legacy failure marker.
