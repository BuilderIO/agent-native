---
"@agent-native/core": patch
---

Tell the model the expected parameter signature when a raw-JSON-schema action
rejects its arguments. Previously only Zod-backed actions echoed the expected
shape, so a model that guessed a wrong enum or type on a raw-schema action got
no new information, re-sent the same arguments, and tripped the identical-error
breaker with the write never executed. The repeated-error stop message is now
written for the user instead of instructing them to fix the tool arguments.
