---
"@agent-native/core": minor
---

Add `runtime.frameworkRoutePrefix` (`AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX`) so a deployment can serve framework routes under a public namespace other than `/_agent-native`. Route registration keeps the internal name; the public prefix is translated once at the request boundary, and every URL the framework hands out (client requests, sign-in and OAuth callbacks, magic links, self-dispatch, deploy adapter routing) is built with the configured prefix. Unset, nothing changes.
