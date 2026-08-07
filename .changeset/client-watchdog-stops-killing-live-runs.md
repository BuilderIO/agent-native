---
"@agent-native/core": patch
---

Stop the chat client from durably aborting background runs that are still
working.

The kill verdict was rendered against a `/runs/active` snapshot fetched
_before_ the SSE attach that had just blocked for its whole duration, so any
progress that landed during the attach was invisible to the decision. Fleet
data: 23 of 24 client-watchdog kills hit runs that had made server-authoritative
progress within the previous 90 seconds. The client now takes a second reading
after the attach, and only on the path that would otherwise condemn the run —
the healthy path pays nothing.

A failed or unparseable `/runs/active` poll no longer counts as "no active run".
Unreadable and absent were the same value, and the absent branch reached the
durable abort without consulting progress at all, so one flaky tick could end a
live turn.

A model-stream retry the user waited through is now narrated instead of silently
wiping the transcript. Three 90-second retries used to blank the screen at 92s,
182s, and 272s with no explanation — the shape people report as "the chat froze".
Fast provider blips stay silent.
