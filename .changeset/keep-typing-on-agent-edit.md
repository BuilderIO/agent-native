---
"@agent-native/toolkit": patch
---

When an open editor picks up a newer saved body, it now takes in changes to other blocks inside the same list, quote or toggle as the one being typed in, and it no longer waits for typing to pause. A change to the very block being typed in is no longer saved over: the editor keeps it pending instead of reporting a merge, so the host's next save goes out against the body its text was written on, and the editor plans the change again on the next edit or snapshot. On a live collaborative doc the whole body waits in that case, since the server marks a revision taken in whole.
