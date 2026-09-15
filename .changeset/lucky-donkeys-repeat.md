---
"@agent-native/dispatch": patch
---

Surface a dead `ask_app` task as an error instead of an endless "still working" poll.

`ask_app_status` already mapped a `failed` task to an error, but that branch was effectively unreachable: nothing terminalized a task whose processor died, so the tool kept handing back a poll handle forever. The framework now sweeps those tasks to `failed`, which makes this a live path for the first time, and it is covered by a test so the poll handle cannot come back for a terminal task.
