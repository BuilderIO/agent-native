---
"@agent-native/agentkit": patch
---

A "Send now" queued message that its run ended without taking, or whose steer was refused because the run had already ended, is now sent as the thread's next turn instead of staying stuck in the queue.
