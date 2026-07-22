---
name: app-permissions
description: >-
  How to enable browser feature permissions (camera, microphone, geolocation,
  screen capture, clipboard, wake-lock) that the framework's default
  Permissions-Policy header blocks. Use when the app must access a device or
  browser capability that is silently failing.
scope: dev
metadata:
  internal: true
---

# App Permissions — Enabling Browser Features

## Rule

When the app needs a browser feature that the default `Permissions-Policy`
disables, re-enable it for first-party use in
`server/plugins/permission-policy.ts` — change only the directive the feature
needs, never weaken the others, and never edit the `@agent-native/*` framework
package.

## Why

There are **two independent layers** between the app and a device capability, and
this skill only touches the first one:

1. **The `Permissions-Policy` gate.** This HTTP response header decides whether a
   feature is even available in the document:
   - `feature=()` — disabled everywhere. The JS API fails and **no browser prompt
     is possible**.
   - `feature=(self)` — allowed for same-origin (first-party) code.
   - `feature=*` — allowed including cross-origin iframes.
2. **The browser's own permission prompt.** The Allow/Block dialog only appears
   when the app's JS actually calls the API (`getUserMedia`,
   `navigator.geolocation.getCurrentPosition`, `getDisplayMedia`, …) **and** the
   gate above allows the feature.

So this skill's job is only to **open the gate**. It does not — and cannot —
grant the permission itself; the user still approves the browser prompt when the
app calls the API. If the gate is closed, the prompt never even shows and the
call silently fails, which is the symptom that brings you here.

The framework sets this default on every response (via `@agent-native/core`'s
security-headers middleware, mounted before routes, last-write-wins):

```
camera=*, microphone=(self), geolocation=(), screen-wake-lock=()
```

Note the empty allowlists: `geolocation=()` and `screen-wake-lock=()` are
disabled document-wide by default. Camera and microphone are already open.

## How

1. **Locate the plugin.** If `server/plugins/permission-policy.ts` already exists,
   edit its `PERMISSIONS_POLICY` string to add or adjust the directive the feature
   needs. If it does not exist, create it from the template below.
2. **Change only what's needed.** Start from the framework default string and flip
   only the directive(s) the feature requires — e.g. `geolocation=()` →
   `geolocation=(self)`. Keep every other directive exactly as the default unless
   the feature genuinely needs it relaxed. Prefer `(self)` over `*`; only use `*`
   when a cross-origin iframe must use the feature (the default already does this
   for `camera`).
3. **Keep the first-request deferral.** The security middleware is registered
   during bootstrap and `Permissions-Policy` is last-write-wins. If this plugin
   called `getH3App(nitroApp).use(...)` at bootstrap time it would register
   *before* the security middleware and be overwritten. Registering inside the
   first `request` hook makes the handler append **after** the security
   middleware, so its value wins. Do not "simplify" this into a bootstrap-time
   `.use()`.
4. **Typecheck.** Editing server source is a Tier 2 change — run `pnpm typecheck`
   afterward (see `self-modifying-code`).

Reference implementation (`server/plugins/permission-policy.ts`):

```ts
import { getH3App } from "@agent-native/core/server";
import { defineEventHandler, setResponseHeader } from "h3";

// Framework default: camera=*, microphone=(self), geolocation=(), screen-wake-lock=()
// Empty allowlist () disables a feature document-wide (no browser prompt).
// Re-enable only what the app needs, for first-party (self) use.
// Registered on first request so this .use() appends AFTER the core
// security middleware (last write wins for Permissions-Policy).
const PERMISSIONS_POLICY =
  "camera=*, microphone=(self), geolocation=(self), screen-wake-lock=()";

export default (nitroApp: {
  hooks?: { hook?: (name: string, cb: () => void) => void };
}) => {
  const hook = nitroApp?.hooks?.hook;
  if (typeof hook !== "function") return;

  let registered = false;
  hook.call(nitroApp.hooks, "request", () => {
    if (registered) return;
    registered = true;
    getH3App(nitroApp).use(
      defineEventHandler((event) => {
        setResponseHeader(event, "Permissions-Policy", PERMISSIONS_POLICY);
      }),
    );
  });
};
```

## Common directives

Map the capability the app needs to the `Permissions-Policy` directive to add:

| Capability | Directive | Recommended value |
| --- | --- | --- |
| Current location | `geolocation` | `geolocation=(self)` |
| Camera | `camera` | `camera=*` (framework default) or `camera=(self)` |
| Microphone | `microphone` | `microphone=(self)` |
| Screen / tab capture | `display-capture` | `display-capture=(self)` |
| Keep screen awake | `screen-wake-lock` | `screen-wake-lock=(self)` |
| Clipboard read/write | `clipboard-read`, `clipboard-write` | `clipboard-read=(self), clipboard-write=(self)` |
| Fullscreen | `fullscreen` | `fullscreen=(self)` |
| Motion / orientation sensors | `accelerometer`, `gyroscope`, `magnetometer` | `accelerometer=(self)` (etc.) |

Add directives to the comma-separated string; the browser ignores tokens it
doesn't recognize, so unknown/experimental features degrade gracefully.

**Not every capability is governed by `Permissions-Policy`.** The Notifications
API and Web Push, for example, are gated only by their own browser prompt — they
need no directive here. For surfacing alerts to the user in-app, see the
`notifications` skill.

## Don't

- **Don't edit `@agent-native/*` package files** or the core security-headers
  middleware — Tier 4, off limits (see `self-modifying-code`). Override the header
  from this app-owned plugin instead.
- **Don't register the handler at bootstrap time.** It will run before the
  security middleware and its header value will be overwritten. Use the first
  `request` hook as shown.
- **Don't broaden a directive to `*`** when `(self)` is enough — `*` exposes the
  feature to cross-origin iframes.
- **Don't blanket-enable** features the app doesn't actually use; keep the closed
  directives closed.
- **Don't add `/api/*` routes or client-side hacks** to work around a blocked
  feature — the fix is the header.

## Related Skills

- **security** — HTTP response headers and app-level data/access permissions
  (distinct from these browser feature permissions).
- **self-modifying-code** — editing server source is a Tier 2 change; typecheck
  after and checkpoint with git.
- **notifications** — user-facing alerts and the Notifications API, which this
  skill does not cover.
- **adding-a-feature** — the four-area checklist when the capability is part of a
  larger feature.
