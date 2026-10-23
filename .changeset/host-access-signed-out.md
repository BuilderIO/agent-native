---
"@agent-native/core": patch
---

Host access resolvers registered with `registerHostAccessResolver` are now asked about signed-out requests too, with `ctx.userEmail` unset, so a host can vouch for a signed-out reader of one resource. Resolvers that only vouch for signed-in people should return `undefined` when there is no email.
