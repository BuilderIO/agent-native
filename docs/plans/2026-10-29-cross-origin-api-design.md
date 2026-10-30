# Cross-Origin API Design

**Date:** 2026-10-29  
**Status:** Draft

## Summary

An Agent-Native app's browser client can talk to an API on a different origin than the page that loaded it. A single runtime setting names the API base. When that base is cross-origin, the client authenticates with a short-lived bearer token instead of the session cookie, the server answers credential-free CORS for an allowlist of front-end origins, and the server's same-origin checks accept a token-authenticated caller in place of a matching `Origin`.

Same-origin deployments keep working exactly as they do today: cookies, no CORS, the existing origin checks.

## Problem

Core assumes the browser client and its API share an origin. Three things encode that assumption:

- **URLs.** `agentNativePath()`, `appPath()` and the chat runtime's `apiUrl` build same-origin paths. The external-embed seam (`window.__AGENT_NATIVE_EXTERNAL_EMBED.target`) accepts a path prefix only; `target` must start with `/`.
- **Auth.** The session cookie, sent with `credentials: "same-origin"` (32 request sites across 20 files in `packages/core/src/client` and `packages/toolkit/src`).
- **Trust.** Server checks such as `isSameOriginVisualEditBrowserRequest` (`Sec-Fetch-Site: same-origin`, `Origin` equal to the request origin) treat any other caller as untrusted.

We do not control how people deploy apps, and a separate API domain is a normal shape: an app on a CDN with its API elsewhere, an app mounted inside another product, a self-hoster's reverse-proxy layout. Hosts that try to stay same-origin pay for it. The Builder integration proxies `/an/design/*` through Firebase Hosting, which buffers streamed responses until they finish and ends every rewritten request at 60 seconds. Agent runs show no progress, and any run longer than a minute fails with a 502 even though it finishes on the server.

## Goals

- One runtime setting points the whole browser client at an API base on any origin.
- A cross-origin client works with third-party cookies blocked (Safari, Chrome's partitioning).
- Streaming (agent chat, run reconnect, realtime sync) works cross-origin.
- Same-origin deployments see no behavior change and no new configuration.
- New code cannot quietly reintroduce a same-origin assumption.

## Non-Goals

- Serving the app's own bundle, web workers or other static assets cross-origin. The page's origin serves its assets; only API traffic moves.
- Cross-origin cookie sessions. Credentialed CORS with `SameSite=None` cookies is not a supported mode.
- Changing how a user signs in. The token is issued from an existing sign-in; the sign-in flow itself is unchanged.

## Design

### API base

`configureAgentNativeApi({ baseUrl })` (exact name open) sets the base for every `/_agent-native/*` and app API URL. It accepts an absolute URL (`https://api.example.com`) or a path (`/an/design`). It is set at runtime, so one bundle serves several environments; a host passes it as a mount option, and a standalone app can read it from the projected runtime config.

`appPath`, `agentNativePath`, `appApiPath` and the chat runtime resolve against it. The external-embed `target` becomes one way of setting it, and the leading-`/` restriction goes away.

The base is **cross-origin** when its origin differs from `window.location.origin`. That single predicate selects the auth and request mode below.

A sweep removes callers that bypass the helpers: raw `fetch("/_agent-native…")`, the three `EventSource`/`WebSocket` sites, upload and download URLs, and comparisons against `window.location.origin` that decide whether a request is "ours".

### Auth

In cross-origin mode, the client authenticates with a short-lived bearer token:

- **Getting one.** The client exchanges proof of identity for a token. The exchange is whatever the deployment already uses to sign in: a host-provided identity (the Builder identity exchange is one), or the app's own sign-in, completed on the API origin and handed back once.
- **Using it.** A fetch interceptor attaches `Authorization: Bearer <token>` to every request whose URL is under the API base, with `credentials: "omit"`. The existing `ensureEmbedAuthFetchInterceptor` already does this for same-origin runtime paths; it is generalized to "under the API base" rather than "same origin".
- **Keeping it fresh.** Tokens are held in memory, never in `localStorage`, and refreshed before expiry. A 401 triggers one refresh-and-replay.
- **Unification.** The embed token in `embed-auth.ts` and the agent-chat `stream-token` become this one API session token, with purpose scoping kept where it exists today.

Same-origin mode keeps the session cookie and sends no token.

### CORS

The server answers CORS for an allowlist of front-end origins, from the existing `CORS_ALLOWED_ORIGINS`:

- It echoes an allowed `Origin`, with `Vary: Origin`.
- It allows `Authorization` and the custom `x-agent-native-*` request headers.
- It sets `Access-Control-Max-Age` so preflights are cached instead of adding a round trip to every call.
- It never sets `Access-Control-Allow-Credentials` for this mode, because no cookie is involved.

The global handler in `server/create-server.ts` already does most of this; the gaps are the header list, `Max-Age`, and making it the path every route goes through.

### Trust

Origin checks exist to stop cross-site request forgery against cookie sessions: the browser attaches the cookie automatically, so the server has to confirm that the request came from its own page. A bearer token is never attached automatically, so a request carrying a valid one cannot be forged by another site.

The rule becomes:

- **Token-authenticated requests** pass the origin checks. Authorization still comes from the token's principal.
- **Cookie-authenticated requests** keep today's checks unchanged.

This replaces host-specific exceptions, such as the Builder-host rule added to the Design template's visual-edit check, with one framework rule.

### Streaming and realtime

- **Agent chat.** The chat POST and run reconnect (`runs/{id}/events`) use `fetch` streaming with the bearer header, so they work cross-origin with no special casing. The Amplify streaming split (`VITE_AGENT_NATIVE_AGENT_CHAT_STREAM_URL`) becomes the general case: the stream is just another request under the API base.
- **`EventSource`.** It cannot set headers. Callers move to `fetch` streaming; where a query-string token is unavoidable, it is short-lived, purpose-bound and excluded from access logs, as the realtime gateway already does.

### Assets and workers

The bundle, its CSS and its web workers load from the page's origin; browsers require workers to be same-origin with the page. Nothing here changes that.

## Compatibility

- Same-origin and path-prefixed deployments (`/an/design` today) behave as before: no token, cookies, the same origin checks.
- The external-embed `target` keeps working; it becomes an alias for the API base.
- The Amplify `VITE_AGENT_NATIVE_AGENT_CHAT_STREAM_URL` keeps working until its users move to the general mode.

## Testing

- An E2E mode that serves the front end and the API from different origins locally (two ports is enough to be cross-origin), with third-party cookies blocked. The core flows (sign-in exchange, actions, agent chat with a long-running turn, reconnect mid-run, realtime sync, uploads) run in that mode in CI.
- A guard that fails on new `credentials: "same-origin"` request sites and raw relative `/_agent-native` URLs in client code, outside an explicit allowlist.

## Rollout

1. API base setting and URL helper resolution; sweep the bypassing callers.
2. Generalized token interceptor and the token exchange; unify the embed and stream tokens.
3. CORS gaps in `create-server.ts`.
4. Token-aware trust rule; remove host-specific origin exceptions.
5. Chat reconnect and remaining `EventSource` callers on `fetch` streaming.
6. The cross-origin E2E mode and the guard.
7. First consumer: Design inside Builder points its API base at a streaming-capable origin, and the `/an/design` API proxy is retired. `/design-host` stays same-origin.

## Open Questions

- **The exchange.** What a standalone app (no host identity) uses to obtain its first token cross-origin: a popup or redirect to the API origin's sign-in, a one-time code handed back on redirect, or something else.
- **Token lifetime and scope.** One token for all requests or separate read, write and stream scopes; the lifetime and refresh window.
- **Realtime.** Whether the realtime gateway's query-string token can move to a header, or stays as the one documented exception.
- **Server-rendered pages.** How server-rendered routes that call the API during render authenticate when the page and API are on different origins.
