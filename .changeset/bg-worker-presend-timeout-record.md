---
"@agent-native/core": patch
---

Extend the background-worker pre-send instrumentation: also time out the required
suspect branches (system prompt / `extraContext`, enriched message) and record
which branch hit its timeout/error fallback into the run's setup diagnostic
(`to=...` in `setupDetail`). The hanging op is then identifiable via
`/runs/active` even when the Netlify function-log drain is unreadable, and the
timeout lets the worker claim past a stuck required read.
