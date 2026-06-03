---
name: client-methods
description: >-
  Client method surface rules. Use when wiring browser/client code to actions,
  application state, framework routes, app APIs, uploads, auth, or settings.
metadata:
  internal: true
---

# Client Methods

## Rule

Browser/client code imports named methods, hooks, or client modules instead of
hand-writing REST calls to framework or app routes.

## Why

Route shapes are transport details. If components and docs call
`fetch("/_agent-native/...")` or template `/api/*` routes directly, every caller
has to rediscover auth, base paths, request-source headers, JSON parsing, error
handling, optimistic updates, sync invalidation, and route quirks. A named client
method gives the UI, docs, and future agents one stable contract.

## How

1. Look for an existing client API first.

   | Need | Use |
   | --- | --- |
   | App action reads/writes | `useActionQuery` / `useActionMutation` from `@agent-native/core/client` |
   | Imperative action calls | `callAction` from `@agent-native/core/client` |
   | Browser application state | `readClientAppState`, `writeClientAppState`, `setClientAppState`, `deleteClientAppState` |
   | Agent chat context | Agent chat client helpers from `@agent-native/core/client` |
   | Live sync | `useDbSync`, `useChangeVersion`, `useChangeVersions` |
   | Extension iframe calls | `appAction`, `appFetch`, `extensionFetch` from the extension runtime |

2. If no client API exists, add the narrowest helper at the boundary.

   - Put shared framework helpers in `packages/core/src/client/*`.
   - Put template-local helpers in `templates/<app>/app/hooks/*`,
     `templates/<app>/app/lib/*`, or an existing local client module.
   - Export reusable core helpers from `@agent-native/core/client`; add a leaf
     export when callers may need to avoid the broad barrel.
   - Keep raw `fetch`, `agentNativePath`, and route paths inside that helper,
     not scattered through components or docs.
   - Add focused tests for URL construction, headers, response parsing, error
     shape, and any sync invalidation.

3. Teach the helper, not the route.

   Docs, skills, examples, and generated code should show:

   ```ts
   await setClientAppState("selection", selection, { keepalive: true });
   ```

   not:

   ```ts
   await fetch("/_agent-native/application-state/selection", {
     method: "PUT",
     body: JSON.stringify(selection),
   });
   ```

## Exceptions

Raw route calls are acceptable only inside low-level client helpers or for
route-shaped protocols that cannot be hidden cleanly:

- multipart uploads
- streaming/SSE/WebSocket transports
- OAuth redirects and callback URL construction
- webhooks and external provider callbacks
- extension sandbox `appFetch` / `extensionFetch`, which are themselves exposed
  client methods
- tests that assert route construction

Even for exceptions, prefer a named helper as soon as more than one caller needs
the behavior.

## Don't

- Don't put `fetch("/_agent-native/...")`, `fetch(agentNativePath(...))`, or
  template `/api/*` calls directly in React components for normal app data,
  actions, settings, or application state.
- Don't document route calls as the way client code should do work.
- Don't add pass-through `/api/*` routes just to make client fetches look
  simpler; expose an action and call it with action hooks.
- Don't duplicate auth/session/base-path/request-source/error parsing logic in
  every component.

## Related Skills

- `actions` — app operations shared by UI and agent.
- `context-awareness` — application-state navigation and selection helpers.
- `real-time-sync` — keeping helper-backed UI reads fresh.
- `server-plugins` — when a new route is actually warranted.

## References

- `references/legacy-client-fetch-audit-2026-06-03.md` — known legacy cleanup
  targets found when this rule was added.
