---
"@agent-native/core": patch
---

Stop reporting `$ai_generation` token/cost figures as literal `0` when the
engine never returned a usage report — every run aborted for no-progress
before any provider response arrived was indistinguishable from a real
empty-input call, which made it impossible to size the input of failing
runs. `input_tokens`, `output_tokens`, `total_tokens`, `cache_read_tokens`,
`cache_write_tokens`, `cost_cents_x100`, `cost_usd`, and their `$ai_*`
equivalents are now omitted from the tracking event instead of coerced to
zero when the engine never reported usage. Also adds `time_to_first_token_ms`,
measuring elapsed time from run start to the first non-heartbeat engine
event, omitted (not zeroed) when no such event ever arrived.
