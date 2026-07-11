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
- Pass events to `Replayer` untouched. rrweb rebuilds them in a sandboxed iframe;
  pre-processing DOM, stylesheet, resource, or mutation payloads makes playback
  diverge from the captured page. Let rrweb own iframe sizing via Meta /
  ViewportResize, and keep the outer wrapper in that same coordinate system for
  fit-to-stage scaling. Never clamp only one layer, rewrite Meta widths, or force
  iframe dimensions — that desyncs the FullSnapshot DOM and breaks the stage.
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
