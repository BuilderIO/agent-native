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
- First-party SQL (`query-agent-native-analytics`, dashboard panels) reads
  `session_recordings` through the same `session-recording` access rule as
  the UI: the caller's own recordings, plus recordings in the active org that
  are org-visible or shared with the caller or that org. Any new SQL path over
  recordings must use that rule, not an `org_id` match.
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

## App Events In Sessions

- `trackEvent` also emits an `agent-native.event` custom event holding only
  `{ name }` (120 chars max, 1000 per replay, counted across page reloads).
  Telemetry names such as `pageview`, `action.response`, and `session status`
  stay unmarked; lifecycle aliases don't get a second marker. Never add event
  properties to the payload.
- The replay viewer shows these markers, plus failed
  `/_agent-native/actions/<name>` requests as "Action failed", only while the
  Sessions triage Lab is on. With the Lab off the viewer and the agent timeline
  keep their earlier shape.
- `recordAnalyticsEvents` writes the per-session event index
  (`analytics_session_events`) and a per-tenant coverage start inside the
  transaction that stores the events, in every sink mode. After that
  transaction commits it writes the daily catalog
  (`analytics_event_catalog_daily`) and each event's latest sighting
  (`analytics_event_catalog_latest`) best-effort, together in one short
  transaction, because the catalog lists events from the latest table. A
  catalog failure only warns, and the catalog never decides a filter. Lists,
  did/didn't filters, and the catalog read only these tables, never BigQuery.
  The catalog keeps the 1,000 most recently seen events, sorted by volume, and
  sets `truncated` when it cut the list; its app flags still count every event
  in the range.
- Indexes hold caller text raw, and one entry over Postgres's limit fails the
  whole batch. Ingest cuts every indexed value with
  `server/lib/indexed-text.ts` (event name, app, template, path) before any
  table sees it. A long user key keeps a prefix plus a hash of the whole value
  (`boundedIdentity`), so two users never merge into one. Row ids built from
  caller text go through `indexedRowId`, which hashes an id that
  percent-encoding made too long. Session and recording ids are never cut,
  because a cut id could merge two sessions: replay ingest rejects session and
  recording ids over 256 characters, and an event's longer session id skips the
  session index. Bound any new indexed caller value there.
- Public ingest (`/track`, `/api/analytics/replay`) returns a thrown message
  only for an error built with `requestError` (a numeric `statusCode`). Any
  other failure is logged and answered with a generic 500, because its message
  can quote internal database details.
- Event filters exclude a session if any of its recordings started before the
  tenant's coverage start, because one analytics session can span tabs.
  Coverage starts only after a session write succeeds, and the reported start
  is the latest among the viewer's tenants. "Didn't" also needs at least one
  index row for the session and no gap marker: a failed index write rolls back
  to a savepoint and records the batch's sessions in
  `analytics_session_event_gaps` in the same transaction, so a later
  successful batch cannot make them look complete. If the marker cannot be
  written either, the batch fails and its events are not stored. Keep session
  index writes inside that transaction. Deploys ship code before the scheduled
  migration creates these tables, so until `analytics_session_event_coverage`
  exists ingest stores events unindexed and warns: with no coverage, no
  session can read as complete. Reads in that window report no coverage
  instead of failing: no event names, a null coverage start, an empty
  catalog, and no session matching an event filter. That is the only unmarked
  gap, and it holds only while the coverage table is the last index table a
  migration creates.
  The retention sweep removes a session's index rows together, once all of
  them are two days past replay retention, and its gap marker after that. The
  BigQuery-cutover purge leaves these tables alone.

## Friction Signals

- Friction is derived at ingest into Analytics' own tables and read only
  from them, in every sink mode. Replay signals (dead clicks, Sonner error
  toasts, retry loops, leaving within 30 seconds of an error, stalled
  requests over `STALLED_REQUEST_THRESHOLD_MS`, 4xx and 5xx responses) come from the
  rrweb chunks in `recordSessionReplayChunks`, one row per recording in
  `session_recording_friction`. Event signals (failed actions, agent
  failures, stuck chats, thumbs-down, quick backs, cancelled runs) and their
  trouble groups come from tracked events in a savepoint nested inside the
  event index savepoint, one row per session in `analytics_session_friction`
  plus `analytics_session_trouble`.
- A request the page aborted itself (status 0 with an error `isBenignAbort`
  in core recognizes, or the recorder's `XMLHttpRequest aborted`) is not a
  failure: it never feeds retry loops or leaving after an error. Neither is
  one the recorder marked `pageLeaving`: the browser cancels in-flight
  requests when the page navigates or reloads, with the same "Failed to
  fetch" as a network failure, so only the recorder can tell them apart. It
  still counts as a stalled request. Any other status-0 failure counts.
- Never store page text or URLs: detector state keeps timestamps, rrweb node
  ids, and hashed request keys; quick backs compare hashed paths.
- One session id spans every tab, so a quick back compares pages only within
  one page load (`page_load_id` on each pageview). Pageviews from older
  clients send no id and are skipped: followed together, two tabs would look
  like one tab going back.
- A replay row counts only while `processed_chunks` equals the recording's
  `chunk_count`. Each batch must continue from the stored detector state and
  its chunk seqs must start exactly at `processed_chunks`, so a batch that
  cannot be measured, or arrives out of order, leaves the row behind and the
  recording reads as unmeasured; never restart from fresh state. An event row
  counts only when the tenant's friction coverage began before every
  recording of the session and the session has neither an event index gap
  nor a friction gap (`analytics_session_friction_gaps`). A friction write
  failure rolls back only friction and records a friction gap; the index
  write stays. Only a failed friction gap insert fails the index savepoint.
- Thumbs-down, cancelled runs, and quick backs are measured only for
  sessions whose pageviews carried `agent_signals`
  (`AGENT_SIGNALS_PAGEVIEW_PROPERTY` in core): older clients sampled stops,
  sent no ratings, and sent no `page_load_id`. One session id
  spans every tab, so an old tab can share a session with a new one: any
  unmarked pageview or sampled stop sets `agent_signals_missing`, and both
  flags are OR-merged. Unless `agent_signals_measured` is set and
  `agent_signals_missing` is not, these counts read as null, stay out of the
  score, never match a filter, and sort last. A stop counts only when sent
  unsampled (`sample_rate` absent or 1).
- Reads must keep "unmeasured" (null) apart from "measured, no friction" (0).
  Until the migration creates `analytics_session_friction_coverage` (created
  last), ingest skips friction, filters match nothing, friction sorts fall
  back to newest, and details report every part as null. A friction filter or
  sort always returns the paginated shape with `frictionCoverageStartedAt`,
  and `view-screen` passes it on, so an empty match is read against coverage,
  never as zero. It covers the viewer's own org and personal tenants: the
  latest start among those with coverage, or null when one without coverage
  has recordings the viewer sees in the range. Recordings shared from other
  tenants read unmeasured on their own rows.
- `errorIssues` links occurrences in `error_events`, which keeps only each
  issue's newest ones, then falls back to issues whose
  `last_session_recording_id` is the recording, with a null count. A
  recording with errors Monitoring could capture and still no issue reads
  null (unknown), never [], unless its owner scope has no issues at all: it
  does not capture errors as issues, so [] is the truth there. Only captured
  exceptions can become issues, and a plain `console.error` never does: the
  recorder marks console errors `exception: false` or `true`, and the replay
  row counts the others in `issue_errors`, so a recording whose only errors
  were plain console errors reads []. A row measured before that column, or
  not measured from its start, falls back to the recording's `errorCount`.
- Agent failures group by a named cause from `AGENT_TROUBLE_CAUSES` in core
  (`no_model_connected`, `rate_limit`, `context_overflow`, `provider_error`),
  else by error code, never by message text. Failed actions group by action
  and status.
  New causes need product approval; add them to that one list.
- The score is a weighted sum with each signal capped at
  `SESSION_FRICTION_SIGNAL_CAP`, computed per part at ingest and summed at
  read. Change weights only in `SESSION_FRICTION_WEIGHTS`.
- Every friction surface is behind the Sessions triage Lab, in the UI and in
  `list-session-recordings`, `list-session-friction`, `view-screen`, and
  `get-session-replay-summary`; a 403 names what the Lab gates
  (`assertSessionsTriageLabEnabled` takes every feature the request used).
  With the Lab off, Sessions looks and behaves exactly as before; ingest
  still records friction. Waiting on the Lab state is shared with the speed
  filter; see "Performance In Sessions".
- Without a friction filter or sort, the list loads without friction and its
  rows read friction from `list-session-friction`, one page of ids at most,
  through the recordings' access filter. A failed friction read then leaves
  the list in place with a retry. With a friction filter or sort, friction
  comes with the list and a failure is a list error.
- The replay's dev tools show a Friction tab with every signal's count, its
  trouble groups, and its issue links. `get-session-replay-summary` returns
  the same `friction` for the agent. A failed Lab state or friction read is
  reported as `labStateError` or `frictionError`, never as no friction. Each
  is a fixed message, because the cause can quote database details; the
  server log keeps it. On
  the list, `view-screen` reports them beside the base list, and its
  `activeFilters` echo the filters it applied, not the URL's. Its row excerpt
  drops trailing rows to stay under the agent's 50,000-character tool-result
  limit, so the page metadata after the rows always arrives; a cut sets
  `truncated`, and `fullPageAction` reads the whole page. Keep it that way
  when adding per-row fields: a bigger row means fewer rows, not a lost page.

## Performance In Sessions

- Core's tracker sends one `web_vitals` event per page view (`route`,
  `navigation_type`, and whichever of `ttfb_ms`, `lcp_ms`, `inp_ms`, `cls` were
  measured; an unmeasured metric is absent, never 0) and an
  `agent-native.vitals` replay marker with the same numbers. `action.response`
  carries the `route` its request started on. `route` is a React Router
  template such as `/sessions/:id`; when no manifest route matches it is
  omitted, never a raw path, which can hold slugs and emails.
- Requests under `SLOW_REQUEST_THRESHOLD_MS` (`shared/slow-request.ts`, 1 s)
  are sampled at 10% with `sample_weight: 10`; slow, failed, and 4xx responses
  always send with weight 1, so slow-request counts are exact. Use that
  constant for every "slow request" rule. Requests made while the page was
  hidden or cancelled are not counted. Slow requests (the app's own actions,
  1 s, counted from events) are not friction's stalled requests (any captured
  replay request, `STALLED_REQUEST_THRESHOLD_MS`, 3 s): keep their names,
  fields, columns, and copy apart, and never show one number under the
  other's label.
- Ingest strips NUL and replaces lone surrogates in `route`, `app`, and the
  session id before hashing, as Postgres would store them; otherwise two
  values that store alike collide in one upsert and fail the batch.
  Measurements above `performanceCeiling` (the open top bucket's floor: 64 s,
  CLS 5) are capped there rather than dropped, and `sample_weight` at 10,000.
  A session value at the ceiling is a floor: summaries list it in `atLeast`
  and the row hint shows it with ≥.
- `recordSessionPerformance` keeps each session's worst vitals and its slow
  requests in `analytics_session_performance`, inside the ingest transaction
  under a savepoint, with the same gap and coverage rules as the event index.
  `recordRoutePerformance` adds weights to fixed histogram buckets in
  `analytics_route_performance_daily` after commit, in its own short
  transaction. A failed write records a gap: `session_id = ''` marks a
  route day, read as `incompleteDates`; a session id marks that session,
  read as `performance.incomplete` and kept by `slow: any` only, since
  missing data cannot rule it out; `vitals` and `requests` need a measured
  slow value. The slow filter correlates on each recording's own tenant. As
  with event friction, a share grants the recording, not its tenant's
  events: a recording shared from another tenant has no speed summary (null)
  and never matches a slow filter. A summary's `slowRequests` is null when the session made no
  measured request. A null summary is a session never measured: its row says
  "Speed not measured", and a slow match or a range from before coverage
  shows when speed coverage began, so it never reads as fast. On
  `list-session-recordings`, `slow` and `includePerformance` always return
  the paginated shape with `performanceCoverageStartedAt`, as friction does.
  Bucket edges are positional, so changing them needs a new
  `PERFORMANCE_HISTOGRAM_VERSION`.
- Percentiles interpolate inside one bucket. Past the first bucket each edge
  is at most 28% above the last, so they are within about 28% of the exact
  value; in the first bucket, within 1 ms (CLS 0.001). Keep that step when
  adding edges, and keep every rating threshold an edge. A value in the open
  top bucket is reported as `atLeast`.
  A metric with no samples is null: no data, never fast. Before the migration
  creates `analytics_performance_coverage`, ingest stores events without these
  aggregates and warns, the slow filter matches nothing, and reads report no
  coverage.
- The replay's slow-request markers come from the `agent-native.slow_request`
  events core records beside each slow `action.response` someone waited for,
  with that event's own duration, status, and outcome. Core and the timeline
  both apply the count's rule (`isWaitedActionResponse`, from core), so a
  marker matches exactly what the row counts and background requests never
  spend the replay's marker budget. Never derive them from replay network events: those stop timing at
  the response headers. Replays from clients without these events show no
  slow-request markers.
- `slow` and `includePerformance` on `list-session-recordings`,
  `list-session-performance`, `list-route-performance`, the replay's vitals
  and slow-request markers, and `performance` on `get-session-replay-summary`
  exist only while the Sessions triage Lab is on.
- Lab state never holds up the base list. The page waits for it only when the
  URL carries Lab-only conditions (did/didn't events, friction signals or
  sorts, `slow`), with one wait for all of them, and for at most 5 s; a
  failed or hung read lists sessions without them and says so once, with a
  retry, rather than telling the user to turn on a Lab that may be on.
  Row speed hints load beside the list through `list-session-performance`,
  like row friction, keyed on the visible recording ids; when they fail the
  page says speed data could not load instead of showing no hints, apart
  from any friction failure. `view-screen` reads Lab state in its own `try`
  and reads row friction and speed hints beside the base list, reporting
  `labStateError`, `frictionError`, and `performanceError` separately; its
  `fullPageAction` asks for both.

## Agent Diagnostics Surface

- `buildSessionReplayAgentContext` includes a `diagnostics` section: up to 50
  console entries and 50 network entries, errors/failures first, with totals
  and truncated flags. Agent-context instructions steer agents to diagnostics
  as the primary debugging signal.
- The agent timeline includes `console-error` / `network-error` markers; error
  markers are kept preferentially under the 200-marker cap. App event, Web
  Vitals and slow-request markers belong to the Sessions triage Lab and stay
  off it (`SESSIONS_TRIAGE_MARKER_TAGS`); add any new Lab marker tag there.
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
  integer >= 1000 inside raw replay JSON at _view_ time, corrupting Meta /
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
- Agent-Native templates already call `configureTracking()` in their roots;
  hosted template deployments only need the normal Agent-Native Analytics
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
