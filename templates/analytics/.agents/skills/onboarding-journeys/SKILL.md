---
name: onboarding-journeys
description: >-
  Build the onboarding journey tree (signup to first output, with % splits,
  last-observed-step counts, window-bounded later activity, and example
  replays) and render a screenshot per step. Use when asked for an onboarding
  storyboard, each cohort's last recorded step or later activity within a
  window, or frames for each onboarding step.
scope: dev
---

# Onboarding Journeys

The pipeline runs without a UI. Codex does all four steps from the terminal:

1. Call `get-onboarding-journey` as an MCP tool of the deployed Analytics app.
   Save the JSON result as `tree.json`.
2. Run the capture CLI from the agent-native checkout:
   `pnpm --filter analytics journey:capture --tree tree.json --out ./frames`
   (`--per-node 2 --concurrency 3`, `--min-aspect` / `--max-aspect`, `--dry-run`
   to print the plan, `--upload` for private `attachmentRef`s).
3. Call Design's `create-journey-canvas` with
   `{ title, tree, frames: [{ nodeKey, exampleIndex, imageUrl?, attachmentRef?, width, height, capturedAt }], designId? }`
   -> `{ designId, url, nodeCount, frameCount }`. Build `frames` from
   `frames/manifest.json`. Design reads event timestamps and replay offsets from
   `tree`; keep `sourceEventAt`, `replayAt`, and `capturedAt` in the capture
   manifest.
4. Lay out and review the canvas.

## The tree

`get-onboarding-journey` returns `JourneyTree`; `format: "summary"` returns the
same counts as an indented `outline` with no examples. Use it first to choose a
window, `app`, `maxDepth`, `minNodeSessions` (small branches merge into an
`other` node), and `maxNodes`.

```ts
type JourneyExample = { sessionId: string; recordingId: string | null; ts: string; offsetMs: number | null; viewport: { width: number; height: number } | null; viewportReason?: string; replayUrl?: string };
type JourneyNode = { key: string; label: string; parentKey: string | null; depth: number; kind: "step" | "other"; n: number; pctOfRoot: number; pctOfParent: number; dropoffN: number; dropoffPct: number; deeperN: number; examples: JourneyExample[] };
type JourneyFollowup = { status: "complete" | "incomplete"; incompleteReason?: "journey_event_read_truncated" | "journey_event_read_invalid" | "journey_event_read_may_have_shifted" | "terminal_cohort_query_too_large" | "followup_aggregate_truncated" | "followup_aggregate_invalid" | "terminal_cohort_mismatch"; observationCutoff: string; observationFollowupDurationMs: { min: number; max: number; mean: number } | null; rightCensoredAtWindowEnd: true; coverage: { journeyEventRead: { rows: number; pages: number; truncated: boolean; paginationConsistency: "stable" | "may_have_shifted" }; followupAggregateRead: { rows: number | null; queries: number; truncated: boolean }; cohortSessions: number | null }; laterRecordedActivityWithinWindow: { total: number | null; byTerminalStepKey: Record<string, number> | null }; noLaterRecordedActivityWithinWindow: { total: number | null; byTerminalStepKey: Record<string, number> | null } };
type JourneyTree = { window: { from: string; to: string }; app: string; rootN: number; coverage: { sessionsWithEvents: number; sessionsWithReplay: number; truncated: boolean }; nodes: JourneyNode[]; followUp: JourneyFollowup; standaloneSetup?: { rootN: number; coverage: { sessionsWithEvents: number; sessionsWithReplay: number; truncated: boolean }; nodes: JourneyNode[] }; notes?: string[] };
```

Analytics returns cohort nodes with counts. When extending a Design storyboard
with screenshots from a separate observed session, add those reference nodes
only to the Design input, set `referenceOnly: true`, and omit the cohort metric
fields. This annotation is for visual references and is not emitted by
`get-onboarding-journey`.

Saved outputs require source-confirmed completion events. Clips uses
`recording_ready`; `recording_started`, transcript-only `recording_completed`,
and `clip_viewed` are not saved outputs. Slides uses explicit
`generation_completed`; `generation_request_accepted`,
`generation_outcome_unresolved`, `generation_failed`, `generation_stuck`,
`generation_cancelled`, and `generation_abandoned` remain distinct attempt
steps. An unresolved event can carry `persisted_output: true`, but it still does
not substitute for `generation_completed`. `deck_edited`, `output_viewed`, and
current deck state also cannot substitute for that event. A missing terminal
event stays absent. Generation and recording starts remain attempt steps, and
retry attempts that reuse a deck's output ID remain separate by their exact
attempt ID. A sessionless Clips completion or Slides lifecycle event is
attached only when its exact output and attempt pair maps to one distinct
eligible onboarding session (`recording_started` for Clips;
`generation_started`, `generation_request_accepted`, or `output_viewed` for
Slides); missing or ambiguous
matches stay unattributed. Output and attempt IDs are never included in the
returned tree.

The journey projection also retains `integration_setup_exposed`,
`integration_method_clicked`, and `integration_method_outcome` as separate
`integration:<flow>:...` steps. These record setup exposure, the selected
method, and its outcome without adding those events to cohort denominators.
Keep `flow: "chat_setup"` separate from first-run onboarding method steps; the
same connection method can appear in both flows. Sessions with those events but
no onboarding cohort event appear under the optional `standaloneSetup` tree;
its counts and percentages have their own root denominator.
For a standalone storyboard, extract `standaloneSetup` and pass it as the
top-level tree to `journey:capture`; the capture CLI reads top-level `nodes`.

- Nodes come parents first. `key` is the path of step keys joined with ` > `;
  `pctOf*` are percents (0-100). `dropoffN` / `dropoffPct` count sessions
  whose last observed step is this node; they do not establish that a user
  exited.
- For each node, `n = dropoffN + sum(returned child n) + deeperN`. `dropoffN`
  is sessions whose last observed step is that node; it is not a confirmed
  exit: a blocked tracker or an event outside the window reads the same.
  `deeperN` counts sessions with a later observed step that is not represented
  as a child, including paths past `maxDepth` or a node-list cap.
- `followUp` groups onboarding sessions by the key of their terminal selected
  step. `laterRecordedActivityWithinWindow` counts sessions with any later
  native Analytics event in the same session; `noLaterRecordedActivityWithinWindow`
  counts the remaining sessions. The read applies the same authenticated
  user/org scope, date window, app, identity bridge, test exclusion, and
  Builder.io email filter as the journey read. It uses one
  frozen `observationCutoff` for every event page and the single aggregate
  query. `observationFollowupDurationMs`
  summarizes the time from each terminal selected step to that cutoff.
  `rightCensoredAtWindowEnd: true` means the no-later count is right-censored:
  no later event was recorded before the cutoff; this is not an abandonment or
  churn outcome. The aggregate contains counts only and does not expose the
  session IDs or member identity keys used internally. The consistency field
  reports `may_have_shifted` when the event read uses multiple `OFFSET` pages;
  a late-arriving event can change page membership inside a historical window
  too. If either read truncates, page boundaries may have shifted, or the
  terminal cohort cannot be covered in one query under the 800,000-character
  SQL limit or 50,000-token parser limit, `status` is `incomplete` and all new
  cohort counts and follow-up duration are `null`; `incompleteReason`
  identifies the limiting read. Do not report percentages from that partial
  result. Existing journey counts and denominators remain independent of this
  follow-up read.
- `maxDepth` defaults to 8 and is bounded at 40. Request `maxDepth: 40` for a
  deeper pass. When sessions continue past the requested depth,
  `coverage.truncated` is true and the boundary node's `deeperN` says how many
  continuations were omitted; the summary outline calls this out explicitly.
  `maxNodes` can also remove child branches, so read `coverage.truncated` and
  `notes` before interpreting `deeperN` as depth-only continuation.
- `pctOfRoot` uses the returned app's `rootN`; query each app separately when
  comparing conversion. An `app: "all"` result has one combined denominator
  and must not be used as an individual app's percentage base.
- Builder connection lifecycle events accept canonical and legacy event-name
  aliases and collapse duplicate aliases in a row sequence. Custom-key setup
  includes first-run `credential_validated` / `credential_saved` outcomes and
  the bounded provider validation/save events. Unrecognized flow or outcome
  values remain `unknown`; they are not counted as failures.
- A session is an analytics session id. One that began before `dateFrom`
  starts mid-journey, so start the window a day early.
- Read `coverage` before using the numbers. `truncated: true` means the event
  read hit `maxEventRows`, a session went past `maxDepth`, or the node list hit
  `maxNodes`; `notes` says which.
  Never report a truncated tree as the whole window.
- The event row cap is shared by onboarding and standalone setup. If it is hit,
  `standaloneSetup` may be an empty, truncated tree because standalone events
  were beyond the read boundary; do not interpret that as zero standalone use.
- An example with `recordingId: null` has no replay the caller can open, and
  `viewportReason` says why the viewport is unknown (`no_recording`,
  `not_captured` for recordings before viewport capture, `unreadable`).
- `offsetMs` is milliseconds from the recording's `startedAt`, not the first
  rrweb event.
- `replayUrl` uses that same offset in `atMs`; the session page converts it to
  the first-event-relative player clock after replay events load.
- Test identities are always excluded; `emailFilter` defaults to
  `exclude_builder`, as in the onboarding metrics. A session with any excluded
  identity is dropped whole.

## Capture

The CLI mints a two-hour recording-scoped replay link with
`create-session-replay-agent-link`, reads the token-gated manifest and every
chunk, then renders each recording once with the local `@rrweb/replay` player
in headless Chromium. Each JourneyTree `offsetMs` is relative to the recording's
`startedAt`; the CLI maps `startedAt + offsetMs` to rrweb's first-event-relative
playhead for seeking, viewport, and route evaluation while preserving the
original offset in frame metadata. If the target precedes the first replay
event, report a frame failure instead of clamping the seek to zero. The CLI
uses a native browser screenshot so dialogs and other top-layer content remain
visible. The token and replay events stay in memory; the CLI writes PNGs and
`manifest.json` with `frames`, `failures` (explicit, with a reason), and
`skipped`. With `--extract-prompts`, it also writes the private local
`prompt-provenance.json` sidecar. Manifest chunk counts and ordering must be
complete; the CLI reads bounded batches only through the requested offsets and
validates every fetched chunk. Fix failures or report them; do not paint over a
missing frame.

`sourceEventAt` preserves the JourneyTree example's original event timestamp;
`replayAt` is `startedAt + offsetMs`, and `capturedAt` is when the CLI rendered
the PNG. Every visible iframe must have a corresponding recorded child document
by the requested replay time. If the child document is missing, the frame is
listed as a failure with code `replay_iframe_content_unavailable` and counts in
`diagnostics`. If unsupported 3D projection, rounded ancestor clipping,
unsupported CSS `clip-path` shapes, unrecognized legacy CSS `clip` values,
masks, or visibility-altering filters prevent the audit from verifying
visibility, the frame is listed with code
`replay_iframe_visibility_unverifiable`; do not treat uncertainty as either
missing content or a successful audit. The check covers every visible iframe
because replay can omit its original source attribute while rebuilding an
isolated frame.

Authenticate to the deployed app, never a local database: run
`npx -y @agent-native/core@latest connect https://analytics.agent-native.com --client codex`
(the CLI reads the bearer it writes to `~/.codex/config.toml`), or pass
`--token` / set `AGENT_NATIVE_TOKEN`. `--app-url` overrides the app. Frame mode
needs a deployment that includes `/sessions/:id?frame=1`.

The default `--capture-mode offline` fetches replay chunks through the
recording-scoped token without app cookies or a referrer, then renders in an
offline browser. Remote images and fonts are not fetched; successful frames
carry `assetStatus: "not_fetched"`, and the manifest says
`remoteAssets: "not-fetched"`. This mode is useful when the recorded page has
no remote media.

Use `--capture-mode browser` when recorded images, posters, video frames, or
iframes matter. The CLI opens the direct recording-scoped agent-access link in
a fresh browser context with empty storage and no app bearer headers. The
Analytics frame loads a recording once, maps each JourneyTree recording-start
offset to rrweb's playhead, and uses the existing bounded screenshot asset
preflight. Each successful frame says `assetStatus: "preflighted"`; a blocked,
unreadable, missing, or oversized asset is an explicit frame failure with
`assetStatus: "preflight_failed"`. Browser asset requests never receive the
CLI's Analytics bearer or browser cookies. The manifest sets
`remoteAssets: "browser-preflight-per-frame"` to describe the capture path;
each frame status describes what happened for that seek.
Before navigation, the CLI intercepts browser requests and blocks private,
loopback, and metadata destinations outside the exact Analytics app origin at
every redirect. It blocks WebSockets and allows cross-origin requests only for
GET/HEAD to public hosts, stripping authorization, cookie, origin, and referrer
headers.
The output directory uses mode 0700 and each file uses mode 0600.

`--extract-prompts` is available only with browser mode. It reads at most 12
visible user-role message text blocks from the materialized replay document at
each requested seek, removes controls and hidden text, redacts obvious
credential assignments, omits SQL and base64 payloads, and caps the run at 200
snapshots, 12 messages per snapshot, 2,000 characters per message, and 8,000
characters per snapshot. The sidecar records how many additional snapshots
were omitted and how many planned snapshots could not be recorded. It writes
the result to `prompt-provenance.json` with restrictive local file permissions.
The sidecar keeps the JourneyTree source-event
timestamp separate from the observed seek offset, rrweb playhead, and
extraction time. Each snapshot also says whether its frame capture or upload
succeeded and includes the failure reason when it did not. This is visible
user-role text at the seek, not proof of an exact source event or attempt-ID
relationship. It is never uploaded, including when `--upload` stores PNGs
through the private attachment action.

Keep recorded URLs and CSS intact for rrweb playback; network controls belong
at the capture boundary. `--upload` stores PNGs through the private upload
action, which checks recording access again. Design's own sandboxed template
previews opt into the cooperative iframe recorder, so their child DOM can be
replayed without granting the parent access to the preview document or
credentials.

Viewport comes from the recording's first rrweb Meta event, stored by replay
ingest in `session_recordings.metadata.viewport` (`first` and `last`). Older
recordings have none.
