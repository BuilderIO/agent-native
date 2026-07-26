---
"@agent-native/core": patch
---

`getRequestUserEmail()` no longer lets a request-scoped read silently inherit
the process-wide `AGENT_USER_EMAIL` identity.

Hand-written `/api/*` routes have no AsyncLocalStorage store of their own, so
`getRequestUserEmail() ?? session?.email` resolved to the deploy env's identity
in preference to the real signed-in user — an admin gate reading it admitted
whoever `AGENT_USER_EMAIL` names, failing open toward more privilege. Three
changes close that:

- Every inbound HTTP request now runs inside a `RequestContext`, established by
  a request-boundary middleware at `~middleware[0]`. The store is deliberately
  identity-free (resolving a session there would mean reading cookies on the
  cached SSR shell path); handlers that do know their caller still nest their
  own `runWithRequestContext`, which shadows it.
- `getAmbientUserEmail()` / `getAmbientOrgId()` name the process-wide identity
  explicitly, for the callers that legitimately have no request behind them:
  CLI invocations, cron and scheduled jobs, seed and QA scripts.
- When a request-scoped read still reaches the ambient identity in a process
  that serves HTTP, it warns loudly and names the env identity instead of
  answering silently.

App authors: a handler that relied on `getRequestUserEmail()` returning
`AGENT_USER_EMAIL` outside an explicit context now gets `undefined` and should
fail closed. Scripts and cron entrypoints that really do mean the process
identity should call `getAmbientUserEmail()`.

`guard:no-localhost-fallback` also now flags `?? process.env.AGENT_USER_EMAIL`
and the `WORKSPACE_OWNER_EMAIL` owner-coercion shape in request-handling code.
