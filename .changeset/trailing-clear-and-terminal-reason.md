---
"@agent-native/core": patch
---

Stop a retry storm from deleting the answer the user already read. A rebuild
correctly refuses to apply a _trailing_ `clear` — there is no successor chunk to
re-emit what it wipes — but it only skipped the clear at the very last index.
Each failed engine attempt emits its own `clear`, so three failures in a row is
the ordinary shape, and the rebuild still applied the first two, splicing every
text and reasoning part out of the run. When the run had made no tool calls this
emptied the content entirely and the builder returned null, so the user's
message was persisted with no assistant reply at all. The whole trailing run of
clears is now skipped; a `clear` with real events after it still applies.

Also make `terminal_reason` write-once on an already-terminal row. Three writers
in three isolates race on that column — the mid-run checkpoint, the run-manager's
finalization, and the background worker's failure path — with no ordering
between them, and last-writer-wins let a late checkpoint relabel a run another
isolate had already finalized. That produced impossible rows (`status='errored'`
carrying a continuation reason, no `error_code`, no terminal event) and
misattributed 130 production runs to a failure mode they never hit. A row that
is still `running` has no honest reason yet and stays writable.
