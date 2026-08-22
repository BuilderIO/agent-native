---
"@agent-native/core": patch
---

Keep-warm now holds several containers open instead of one.

A single sequential health request warms exactly one container. Measured on
www.agent-native.com, roughly half of requests still reported `cold` with
keep-warm running every minute, because each cold render occupies its container
for ~4s and anything arriving meanwhile lands on a new one. The scheduled
function now issues its warm requests concurrently — overlap is what makes the
platform hold more than one open. Defaults to 3, configurable through
`AGENT_NATIVE_KEEP_WARM_CONCURRENCY` and capped at 10.
