---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Stopping a run keeps what it wrote. The partial reply and any tool calls that finished before Stop are saved to the thread as the turn's stopped reply, so a reload shows the same text followed by "Stopped", the next turn's model sees it, and the thread gets its title. Before, Stop expired the run's execution lease and the run's own save was refused, so the thread lost the reply. If that save still fails, the run is left for the stale-run projection retry instead of being dropped.

A stopped run's "Stopped" line stays under its reply, or under its prompt when it wrote nothing, after later turns finish. A reloaded thread links each saved reply to its run, and a run loaded without its events is placed by its end time, so the line no longer drops to the bottom of the transcript.
