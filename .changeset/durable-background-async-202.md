---
"@agent-native/core": patch
---

Durable background agent-chat runs now actually receive Netlify's 15-min async
budget. The emitted `-background` function declared a custom `config.path` but
omitted `background: true`, so Netlify served it SYNCHRONOUSLY (~60s) — the
`config` object overrides the legacy `-background` filename convention — and the
durable worker was capped at the 60s wall (it degraded to 40s-chunked runs and
never used the 15-min budget). The emit now sets `background: true` (immediate
202 ack + 15-min execution) and force-marks the background runtime in the
function entry so the worker reliably takes the ~13-min soft-timeout regardless
of the deployed Lambda name. Root cause confirmed with a live prod routing probe
(POST to the process-run path returned a synchronous 401 from the handler
instead of a 202 async ack).
