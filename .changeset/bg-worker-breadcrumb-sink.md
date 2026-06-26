---
"@agent-native/core": patch
---

DIAGNOSTIC: background-worker breadcrumb sink. The bg fn fire-and-forget POSTs
its `[bg-presend]` breadcrumbs to a key-gated foreground `/bg-log-sink` route so
the worker's post-`model_done` setup progress is readable — the worker's own DB
diag writes stall there and Netlify doesn't surface background-function logs.
Also disambiguates event-loop-block vs DB-hang (if the POSTs land, the event loop
is fine). Temporary; removed once the analytics worker freeze is fixed.
