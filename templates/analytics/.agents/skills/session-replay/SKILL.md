---
name: session-replay
description: Inspect, troubleshoot, and extend Analytics session replay recordings.
scope: dev
---

# Session Replay

Use this skill when working on `/sessions`, replay ingest, replay storage, or
agent answers about browser recordings in the Analytics template.

## Source Of Truth

- Replay ingest writes `session_recordings` and `session_replay_chunks`.
- The UI and agent must use `list-session-recordings`,
  `get-session-replay-summary`, and `get-session-replay-events`.
- `/sessions/:recordingId` is keyed by `session_recordings.id`, not
  `analytics_events.session_id`.
- Do not add actions that synthesize "sessions" from `analytics_events`.
  Events can be linked beside a recording through `session_id`, but they are not
  playable replay rows by themselves.

## Storage And Access

- Never expose object-storage URLs or raw `session_replay_chunks` rows to the
  browser or agent.
- Playback bytes must go through scoped server helpers that check
  `session-recording` access before reading private blob refs.
- SQL inline chunks are a local/dev fallback only; production should use
  private or encrypted blob storage.
- A local Analytics app pointed at a production database must also use the key
  that encrypted those replay blobs. Set `ANALYTICS_SECRETS_ENCRYPTION_KEY` in
  an untracked local env file; do not replace the workspace-wide
  `BETTER_AUTH_SECRET` just to read production replay storage.
- When sharing a replay with an external agent, use
  `create-session-replay-agent-link`. It mints a two-hour `agent_access` URL
  scoped to the recording, embeds a small SSR discovery payload on
  `/sessions/:recordingId`, and advertises
  `/api/session-replay/agent-context.json` plus bounded
  `/api/session-replay/agent-events.json` and
  `/api/session-replay/agent-diagnostics.json` reads.
- Do not make session recordings public just so an agent can inspect them.
  Tokenized agent links are the intended handoff path.

## Console And Network Capture

- While recording, the core client (`session-replay.ts` in
  `@agent-native/core`) patches console (`log`/`info`/`warn`/`error`/`debug`),
  window `error` / `unhandledrejection`, `fetch`, and XHR, and emits rrweb
  custom events tagged `agent-native.console` and `agent-native.network`.
- Capture is on by default whenever session replay is enabled. Tune or disable
  it with the `console` / `network` options on the session replay config; each
  accepts a boolean or an options object (`{ maxEvents?: number }`); `network`
  also accepts `captureErrorBodies` (default true) and `maxErrorBodyLength`
  (default 2048) to control the bounded 5xx response-body snippet.
- Privacy bounds: request bodies and headers are never captured. Response
  bodies are captured only as a bounded, redacted snippet for 5xx (server
  error) responses, capped at `maxErrorBodyLength` chars; non-5xx and
  network-failure (status 0) responses never carry a body. URLs are scrubbed,
  messages are truncated, and recorder self-traffic (the replay ingest and
  tracking endpoints) is excluded.
- Per-session budgets: 1000 console events and 2000 network events, with a
  truncation notice event once a budget is hit.
- On ingest, `deriveReplaySignals` computes the real `errorCount` from tagged
  console events plus the additive `networkErrorCount` column on
  `session_recordings`. Keep new columns additive.

## Agent Diagnostics Surface

- `buildSessionReplayAgentContext` includes a `diagnostics` section: up to 50
  console entries and 50 network entries, errors/failures first, with totals
  and truncated flags. Agent-context instructions steer agents to diagnostics
  as the primary debugging signal.
- The agent timeline includes `console-error` / `network-error` markers; error
  markers are kept preferentially under the 200-marker cap.
- `apis.diagnostics` advertises the fuller bounded list:
  `GET /api/session-replay/agent-diagnostics.json?id=<recordingId>&agent_access=<token>&kind=console|network|all&level=<level>&limit=<n>&offset=<n>&fromMs=<n>&toMs=<n>`
  (limit defaults to 200, max 500). It uses the same recording-scoped
  `agent_access` token as the other agent JSON APIs.
- `offset` and `fromMs`/`toMs` (inclusive offsetMs window) enable full
  enumeration of a session's captured entries: page with `offset`, or window
  with `fromMs`/`toMs` around a timeline marker's `offsetMs`. Providing any of
  these switches ordering to strictly chronological (no errors-first
  reshuffle) so pages are stable and disjoint. `total`/`errorCount`/
  `warnCount`/`failedCount` reflect the filtered (windowed/level/kind)
  population, not just the returned page, and each kind's response includes
  `hasMore` alongside `truncated` so an agent can tell whether more entries
  remain. Route validation rejects negative/non-numeric `offset`/`fromMs`/
  `toMs` and `fromMs > toMs` with 400.

## Dev Tools Panel

- The `/sessions/:recordingId` replay player has a Dev Tools toggle that opens
  a panel with Console and Network tabs: filter chips, search, an error-count
  badge, and playback-time highlighting.
- Rows expand inline under the selected line (Chrome-style). Expanding a row
  does not seek; use Jump to to move the playhead. Extend this panel instead of
  adding a separate debugging surface.

## Playback Viewer

- Wait for all replay chunks (`isComplete`) before constructing the rrweb
  `Replayer`. Progressive chunk publishes should only update the loading bar;
  rebuilding the player mid-load desyncs the scrubber and playhead.
- Pass normal events to `Replayer` untouched. rrweb rebuilds them in a sandboxed
  iframe; pre-processing DOM, stylesheet, resource, or mutation payloads makes
  playback diverge from the captured page. In particular, never rewrite `href`, `src`,
  `_cssText`, CSS `url()`, or Meta URLs to `about:blank`; that exact remediation
  broke historical replay CSS in PR #2040. Handle request privacy at capture or
  the sandbox boundary instead of mutating stored rrweb events. Historical
  captures without inlined resources require live stylesheet/image/font
  requests for accurate rendering; the viewer accepts that fidelity tradeoff,
  uses rrweb's script-disabled sandbox plus `referrerpolicy="no-referrer"`, and
  must never add credentials or proxy those URLs through a privileged server.
- Capture-time URL scrubbing must preserve load-bearing DOM resource attributes:
  `src`, `srcset`, `poster`, `data`, and `href` only on resource links such as
  stylesheets, preloads, and icons. Signed CDN query parameters are part of the
  resource identity; redacting them produces missing CSS, fonts, images, and
  oversized fallback icons. Keep scrubbing Meta/navigation URLs, anchor hrefs,
  and console/network diagnostics. Captured `_cssText` and CSS `@import`/`url()`
  values must remain byte-identical.
- rrweb rebuilds into an `about:srcdoc` iframe, which inherits the Analytics
  document's CSP. Analytics currently sends no CSP header; if a future change
  adds restrictive `style-src`, `font-src`, or `img-src` directives, verify
  historical replays and resolve external imports/fonts at capture before
  blocking the recorded resource origins. Do not diagnose current font loss as
  CSP without checking the deployed response headers first.
- Let rrweb own iframe sizing entirely via Meta / ViewportResize, and keep the
  outer wrapper on the exact same raw dimensions for fit-to-stage scaling.
  Player geometry and pointer coordinates are fully stock and untouched — do
  not add width/aspect-ratio "recovery" heuristics or pointer-coordinate
  projection. There is no such thing as a stored recording with corrupt
  viewport geometry: a census of all production recordings found zero stored
  widths >= 3,000px. The 2026-07 "ultra-wide replay" bugs (stages rendered
  3,000–9,500px wide, frozen/teleporting cursors, giant icons) were caused
  entirely by demo mode's fetch interceptor: its number redactor faked any
  integer >= 1000 inside raw replay JSON at *view* time, corrupting Meta /
  ViewportResize widths, pointer x/y coordinates, and numeric values inside
  `_cssText` and SVG attributes before rrweb ever saw the payload (heights
  below 1000 stayed real, which is why the symptom looked like a viewport
  problem rather than a redaction bug — two different sessions that both
  stored a 1,152px width read back as the same 4,491px, a deterministic
  salted-hash fingerprint of the redactor, not two coincidentally identical
  malformed recordings). This is fixed in
  `packages/core/src/demo/fetch-interceptor.ts`: raw replay payload and
  manifest URLs are skipped from demo number redaction entirely, and must
  never be routed through it again. Do not reintroduce viewport clamping or
  pointer-coordinate projection in the player — they can now only corrupt
  genuine future recordings (for example, a real 3440x900 ultrawide browser
  window, or a short vertical window under 1,000px tall).
- Keep rrweb's stock cursor stylesheet and its hotspot transform. During
  playback, hide the viewer's native pointer over Analytics' transparent
  click-to-pause overlay so it cannot masquerade as a frozen recorded cursor.
- Keep rrweb's recorded focus handling enabled. Focus and focus-visible state
  affect menus, forms, and keyboard UX; disabling `triggerFocus` makes a valid
  snapshot diverge from the source page.
- `insertStyleRules` may suppress known toast/snackbar containers only. Never
  hide generic framework primitives such as
  `[data-radix-popper-content-wrapper]`: Radix dropdowns, selects, tooltips,
  and other real recorded product UI all share that wrapper.
- Keep the realistic-fidelity purity/pass-through tests in
  `SessionDetailPage.spec.ts` — raw event identity, raw viewport dimensions,
  and raw resize-state derivation (including the 3,189x885 tripwire against
  reintroducing a clamp) — as regression guards against reintroducing any
  viewport "recovery" or pointer-projection heuristic. Do not change their
  expectations merely to bless a new sanitizer or clamp; validate the affected
  replay in a browser first. An interim clamp for the exact 3,189x885 pair was
  also deleted once the view-time redaction root cause was proven; the earlier
  3,000-3,999px band was rejected because it also catches real 3440px-wide
  displays. Neither the exact exception nor the band belongs in the player.
- The event timeline soft-highlights the active marker, auto-scrolls it into
  view (pausing briefly after manual scroll), and supports search. It appears
  beside the player from ~880px content width upward.
- Dev Tools height is capped so the replay stage never collapses into a ribbon
  on short viewports; the scrubber playhead stays visually distinct from red
  error marker dots.

## Debugging A User-Reported Bug

1. Search the reporting user's email on `/sessions` to find their recordings.
2. Open the relevant session at `/sessions/:recordingId` and click
   **Copy for agent** to mint the two-hour tokenized link.
3. Paste the link to an agent. The agent fetches
   `/api/session-replay/agent-context.json`, reads the `diagnostics` section
   and timeline markers first, then drills into `apis.diagnostics` (filtered
   by `kind`/`level`) and `apis.events` for the fuller bounded lists as needed.
4. For human verification, open the Dev Tools panel in the replay player and
   jump-to-seek from the failing console or network row.

## Capture Defaults

- Replay is on by default for signed-in hosted users when
  `VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY` or `configureTracking({ key })` is
  present. The default sample rate is 100% of eligible sessions.
- Replay remains off when no first-party analytics key is configured, and it is
  not auto-enabled on localhost/local dev. Consumers can still enable replay
  directly with
  `configureTracking({ key, endpoint, sessionReplay: { enabled: true } })`.
- Apps can opt out with `configureTracking({ sessionReplay: false })`.
- Agent Native templates already call `configureTracking()` in their roots;
  hosted template deployments only need the normal Agent Native Analytics
  Vite/Netlify env vars on the recorded site.
- Inputs are masked by default. Page text is visible unless marked with
  `.an-mask` or `data-an-mask`.
- Use `.an-block`, `.an-ignore`, `data-an-block`, or `data-an-ignore` for
  sensitive zones that should not be captured.
- A definitive upload `409` abandons only the conflicted replay identity and
  immediately starts rrweb again under a fresh per-tab id, producing a new
  Meta + FullSnapshot for long-lived SPA tabs. Recovery is limited to one
  restart until an upload succeeds so a misconfigured endpoint cannot loop;
  Analytics tracks the content-free `session replay upload rejected` lifecycle
  event so conflicts and recovery success are measurable.
- Do not label an old recording "corrupt" from pointer coordinates, unknown
  mutation node ids, or changing Meta geometry alone. Those shapes can be
  legitimate with scrolling, iframes/shadow DOM, navigation, and resize. A
  historical-artifact notice needs a durable capture/ingest marker or another
  low-false-positive invariant; do not guess from playback heuristics.
