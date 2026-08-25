---
"@agent-native/core": patch
---

Make `fail()` reach the caller, and stop retrying deterministic action failures.

`fail()` threw a bare `Error`, which the action HTTP route cannot distinguish
from a driver or upstream blowup. Every refusal written for a person became a
500 `"Internal server error"` with the real message dropped and an
error-tracking report filed. It now raises an `ActionContractError` with a
default 400, so the message, `errorCode`, and `details` survive the transport,
and it accepts an explicit `statusCode` for causes like 404 or 409. `fail()`
now lives beside that error in `action.ts` and is exported from
`@agent-native/core/action` as well as the package root.

`defaultActionQueryRetry` retried by exclusion, so every status nobody had
added to its deny list was retried three times. A `useActionQuery()` read
refused with 400, 404, or 409 cost four executions, and a 500 cost four
duplicate error reports. It now retries by exception: `429`, `502`, `503`, and
`504`, plus one retry for status-less network failures. A 500 is an action's
own unhandled throw, so it is treated as deterministic and surfaces on the
first response.
