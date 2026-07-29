---
"@agent-native/core": patch
---

Keep background and scheduled recovery workers from starting duplicate recurring integration jobs that can exhaust shared database capacity and delay messaging replies.
