---
"@agent-native/core": patch
---

Chat transcript now reports work accurately. Each work group in a turn shows its own duration instead of every group repeating the whole-turn time, a `tool_done` that matches no in-flight card settles that card rather than being dropped (which left tools spinning "Still working" for the rest of the turn), and a tool that never reported back renders as an unknown outcome instead of a spinner or a clean success.
