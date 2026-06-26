---
"@agent-native/core": patch
---

fix(agent): run the durable background-function worker inside the run owner's request context (`runWithRequestContext({ userEmail })`). The cookieless `_process-run` worker only seeded the owner for `getOwnerFromEvent`, but engine resolution (`detectEngineFromUserSecrets`) and other owner-scoped reads use `getRequestUserEmail()`/`getRequestOrgId()` from the AsyncLocalStorage request context, which the worker left empty. As a result the worker missed the owner's Builder credential, fell back to the anthropic default, and — when the owner had no stored anthropic key and deploy-credential fallback was blocked (hosted prod) — bailed at the API-key check before ever claiming its run, so durable background runs for such apps (e.g. analytics) only ever completed via the slow foreground inline-recovery. The worker now resolves the same engine/credential the foreground does and claims its run.
