---
"@agent-native/core": patch
---

diag(agent): record peak RSS (MB) and assembled system-prompt size (KB) in the agent run's setup-timings breakdown, to localize background-worker setup cost (OOM-kill investigation for the heaviest workers). Foreground-visible; no behavior change.
