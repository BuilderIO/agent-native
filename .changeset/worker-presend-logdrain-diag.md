---
"@agent-native/core": patch
---

Diagnostic + defensive instrumentation for the durable background-agent worker's
pre-send setup. Adds stdout breadcrumbs (`bgLog`, gated on the worker → Netlify
function logs, independent of DB writes which stall in the failing case) across
the post-`model_done` / pre-claim sequence and each parallel pre-send branch
(enrich, loop settings, system prompt, view-screen, url, selection, files
inventory) with start/done/error/timeout. The OPTIONAL context reads
(view-screen, url, selection, files) now race a short timeout with a safe `""`
fallback so one stuck read cannot block the worker from reaching
`claimBackgroundRun`. Used to localize the analytics-only worker freeze that the
DB-based diagnostic can't see.
