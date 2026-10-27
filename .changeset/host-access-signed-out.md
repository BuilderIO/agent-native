---
"@agent-native/core": patch
---

`registerHostAccessResolver` takes an `{ includeSignedOut: true }` option for a host that vouches for signed-out readers of one resource. Only a resolver registered with it is asked about signed-out requests, with `ctx.userEmail` unset; every other resolver is still asked only about signed-in requests, as before.
