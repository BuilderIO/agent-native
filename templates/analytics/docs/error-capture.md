# Error capture

First-party, Sentry-style exception tracking built into the analytics product.
The browser SDK automatically captures uncaught exceptions and unhandled
promise rejections, exposes a manual `captureException` / `captureMessage` API,
and links every error to the **session replay** it happened in. Captured errors
are grouped into **issues** by fingerprint and triaged under **Monitoring →
Errors**.

## How it works

```
Browser SDK  ──$exception──▶  /api/analytics/track  ──▶  error_issues + error_events
(auto + manual capture)      (first-party ingest fork)     (grouped issues + occurrences)
       │                                                          │
       └── session replay id (localStorage) ───────────────────▶ linked to /sessions/<id>
```

- **Capture** happens in the analytics client SDK
  (`@agent-native/core/client`), installed by `configureTracking`.
- **Transport** reuses the existing first-party analytics ingest: exceptions are
  sent as a dedicated `$exception` event using the same public-key auth and
  `sendBeacon`/`keepalive` transport as pageviews. No extra endpoint, CORS, or
  key to configure.
- **Server** forks `$exception` events out of the analytics batch, parses the
  stack, computes a stable fingerprint, upserts the grouped issue, appends the
  occurrence, and links the session replay. The event is still recorded in
  `analytics_events`, so existing alerting keeps working.

## Enabling capture

Templates already call `configureTracking`. Error capture **auto-enables**
whenever a first-party analytics public key is configured (the same trigger as
pageview tracking and session replay). To be explicit or to tune it:

```ts
import { configureTracking } from "@agent-native/core/client";

configureTracking({
  key: "anpk_...", // first-party analytics public key
  endpoint: "https://analytics.example.com/api/analytics/track",
  errorCapture: true, // or an options object; pass `false` to disable
});
```

Options (`errorCapture` object form):

| Option                       | Default     | Description                                   |
| ---------------------------- | ----------- | --------------------------------------------- |
| `release`                    | `undefined` | Build/release id attached to every exception. |
| `environment`                | Vite `MODE` | Deployment environment (e.g. `production`).   |
| `captureGlobalErrors`        | `true`      | Auto-capture `window.onerror`.                |
| `captureUnhandledRejections` | `true`      | Auto-capture `unhandledrejection`.            |
| `maxBreadcrumbs`             | `20`        | Breadcrumb ring-buffer size.                  |

> Exceptions are only transmitted from non-local hostnames (same rule as the
> rest of first-party analytics). In local dev the handlers still install, but
> nothing is sent — use the **Send test error** button or the
> `capture-test-error` action to exercise the pipeline end to end.

## Automatic capture

Once installed, the SDK listens for:

- **`window.onerror`** — uncaught synchronous and asynchronous errors.
- **`unhandledrejection`** — promise rejections with no `.catch`.

Each is normalized into `{ type, message, stack, url, handled, level, … }`,
redacted, deduped (identical signatures within a short window are dropped), and
sent. The session replay recorder already logs these to the replay timeline, so
auto-captured errors are **not** re-emitted onto the timeline to avoid
double-counting.

## Manual API (Sentry-style)

```ts
import { captureException, captureMessage } from "@agent-native/core/client";

try {
  doRiskyThing();
} catch (err) {
  captureException(err, {
    level: "error",
    tags: { area: "checkout", plan: "pro" },
    extra: { cartId, itemCount },
  });
}

captureMessage("Payment webhook retried", "warning");
```

- `captureException(error, context?)` — `context` accepts `tags` (low-cardinality
  strings), `extra` (structured detail), and `level`
  (`fatal | error | warning | info | debug`, default `error`).
- `captureMessage(message, level?)` — capture a string as an exception-like
  event (default level `info`).
- `addErrorBreadcrumb({ category, message, level? })` — add a privacy-safe
  breadcrumb to the bounded trail attached to the next captured error.

Manual captures **are** surfaced on the active session replay timeline as a
custom event, so they show up when you watch the replay.

Both functions are safe to call before `configureTracking` runs (they no-op
until transport is installed) and never throw back into your app.

## Session replay linkage

The SDK reads the current session replay id from `localStorage`
(`agent-native.session_replay_id`) and attaches it to each exception. At ingest
the server resolves it to the real recording (`sr_...`) and stores it on the
occurrence and the issue (`lastSessionRecordingId`). In the Errors UI, each
issue and occurrence with a linked replay shows a **Watch session replay** link
straight to `/sessions/<recordingId>`, so you can watch what the user did right
before the error.

The link goes both ways. When you watch a recording and open its devtools
**Console** panel, any captured error line (uncaught exceptions, unhandled
rejections, manual `captureException`) gets a **View issue** link straight to
its grouped issue detail (`/monitoring?view=errors&issue=<id>`) — how many users
hit it, the stack trace, and recent occurrences. Resolution is exact, not
heuristic: the `match-error-issues` action recomputes each console line's
fingerprint with the same helpers used at ingest and looks it up under access
scope, so a link only appears when the error was actually captured as an issue.

## Privacy & redaction

- Messages and stacks are scrubbed for credential-looking values
  (`Authorization`, `Cookie`, `token`, `apiKey`, bearer/basic tokens, …) before
  they leave the browser, reusing the same redaction as replay capture.
- URLs are scrubbed of query strings/tokens.
- Breadcrumbs are bounded (ring buffer) and only record navigation + explicit
  messages — no DOM values or input contents.
- Payloads are size-bounded (message, stack, tags, extra, breadcrumbs).

## Data model

Two additive, owner-scoped tables (`server/db/schema-errors.ts`):

- **`error_issues`** — one row per fingerprint per owner scope. `ownableColumns()`
  - `error_issue_shares`, so an org-scoped analytics key surfaces issues to the
    whole org via `accessFilter` (mirrors `session_recordings`). Tracks status
    (`unresolved | resolved | ignored`), counts, first/last seen, users affected,
    culprit/title, and the last linked recording.
- **`error_events`** — individual occurrences (owner-scoped like
  `analytics_events`), pruned to a bounded retention per issue so occurrences
  can't grow unbounded. Stores normalized stack frames, breadcrumbs, tags/extra,
  and the resolved session recording.

Grouping keys off error type + top in-app stack frame (function + normalized
file, ignoring line/column so small edits don't split a group), falling back to
a normalized message when there is no usable stack. A resolved issue is
automatically **reopened** when it recurs; **ignored** issues stay muted.

## How the agent triages issues

The agent uses the same owner-scoped actions the UI does:

- **`list-error-issues`** — list grouped issues, filter by status, search, sort
  by last seen / event count / first seen.
- **`get-error-issue`** — one issue with recent occurrences (parsed stack
  frames, breadcrumbs, tags/extra) and links to the session replays where it
  happened.
- **`resolve-error-issue`** — set status (`unresolved` / `resolved` / `ignored`)
  and optionally (re)assign a triage owner.
- **`capture-test-error`** — generate a sample captured error to verify the
  pipeline end to end.
- **`match-error-issues`** — resolve a batch of session console error lines
  (message/stack/source) to their captured issue ids, so a session recording can
  deep-link to issue detail. Read-only; fingerprints match ingest exactly.

New issues also raise a best-effort inbox notification (via
`notifyWithDelivery`) so a fresh error surfaces without opening the dashboard.
