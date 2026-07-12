---
"@agent-native/core": minor
---

Export first-class A2A auth primitives for the HTTP action route so workspaces
stop reaching into core internals:

- `verifyA2AToken` (and `A2ATokenPayload`) from `@agent-native/core/a2a` — the
  same verifier the `/_agent-native/a2a` endpoint uses, including org-level
  fallback secrets. Apps no longer need to reimplement a partial HS256 verifier.
- `AGENT_RUN_OWNER_CONTEXT_KEY`, `seedAgentRunOwnerContext`, and
  `AgentRunOwnerContext` from `@agent-native/core/server` — a typed contract for
  pre-seeding the resolved caller, replacing the hardcoded context-key string.
- A new `actionRouteAuth` option on `createAgentChatPlugin` (and `ActionRouteAuthAdapter`
  / `actionRouteAuth` on `mountActionRoutes`). Its `resolveCaller` runs before
  the `getSession` chain on `/_agent-native/actions/*`, letting apps accept A2A
  JWTs declaratively instead of intercepting Nitro's `request` hook. Returning
  `null` defers to the existing framework auth chain; throwing hard-rejects the
  request with a 401 so an invalid credential can't fall through to a
  same-origin session cookie. A resolved caller's org comes exclusively from
  the verified credential — the adapter-returned `orgId`
  (`ActionRouteResolvedCaller`) or the owner-email membership lookup — never
  from ambient session/org cookie state, so a request carrying both a valid
  A2A bearer and an unrelated browser cookie can't execute under the cookie
  user's org. A2A writes stay org-scoped.

All additive — existing callers are unaffected.
