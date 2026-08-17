---
"@agent-native/core": patch
---

Name the Builder gateway's unhandled-500 envelope instead of letting it end a
turn as `unknown`.

The gateway can answer 200 and then emit an in-stream error frame whose whole
message is its own internal envelope ("Sorry, we ran into an issue processing
your request. ERROR ID: …"), with no code and no status. That matched no
classifier, so the turn died on the first attempt — no engine retry, no
continuation, `error_code = 'unknown'` in `agent_runs`, and Builder's internal
correlation id rendered as the assistant's answer. The identical body arriving
as an HTTP 500 was always retried.

`classifyTerminalErrorCode` now returns `builder_gateway_internal_error` for
that envelope, the engine marks it `providerRetryable` so the verdict survives
the Builder-credits message rewrite, and every predicate that lists `http_500`
lists it too. The chat now shows what broke and keeps the error id in the
details.
