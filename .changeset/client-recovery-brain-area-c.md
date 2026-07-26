---
"@agent-native/core": patch
---

Stop the chat client from competing with the server's run recovery. The browser
no-progress watchdog now sits above the server's authoritative backstop,
suspends while a tool call or A2A delegation is open, and reattaches to the run
instead of aborting it. Background follow gained per-turn run/time budgets so a
redispatch loop can no longer spin indefinitely, empty continuations back off
exponentially, a trailing `clear` event can no longer wipe a rebuilt transcript,
and the "agent stopped without sending a final message" notice is suppressed
while the server still reports the run as running.
