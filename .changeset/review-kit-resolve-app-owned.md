---
"@agent-native/core": patch
---

Comments & Review Kit: `resolve-review-thread` now refuses a resource registered with `commentsWrittenByApp`, whatever its resolve role, so a thread can't be resolved, reopened or given a resolution note through the kit while the app still writes its comments. Before, a resource that let viewers resolve could still take a resolution note on an already-resolved thread. Clips now mirrors every comment write into the kit and copies its existing comments once at startup.
