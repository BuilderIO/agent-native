---
name: onboarding-journeys
description: >-
  Build the onboarding journey tree (signup to first output, with % splits,
  last-observed-step counts, and example replays) and render a screenshot per
  step. Use when asked for an onboarding storyboard, where users stop being
  observed, or frames for each onboarding step.
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
   `frames/manifest.json`.
4. Lay out and review the canvas.

## The tree

`get-onboarding-journey` returns `JourneyTree`; `format: "summary"` returns the
same counts as an indented `outline` with no examples. Use it first to choose a
window, `app`, `maxDepth`, `minNodeSessions` (small branches merge into an
`other` node), and `maxNodes`.

```ts
type JourneyExample = { sessionId: string; recordingId: string | null; ts: string; offsetMs: number | null; viewport: { width: number; height: number } | null; viewportReason?: string; replayUrl?: string };
type JourneyNode = { key: string; label: string; parentKey: string | null; depth: number; kind: "step" | "other"; n: number; pctOfRoot: number; pctOfParent: number; dropoffN: number; dropoffPct: number; examples: JourneyExample[] };
type JourneyTree = { window: { from: string; to: string }; app: string; rootN: number; coverage: { sessionsWithEvents: number; sessionsWithReplay: number; truncated: boolean }; nodes: JourneyNode[]; notes?: string[] };
```

Analytics returns cohort nodes with counts. When extending a Design storyboard
with screenshots from a separate observed session, add those reference nodes
only to the Design input, set `referenceOnly: true`, and omit the cohort metric
fields. This annotation is for visual references and is not emitted by
`get-onboarding-journey`.

The journey projection also retains `integration_setup_exposed`,
`integration_method_clicked`, and `integration_method_outcome` as separate
`integration:<flow>:...` steps. These record setup exposure, the selected
method, and its outcome without adding those events to cohort denominators.
Keep `flow: "chat_setup"` separate from first-run onboarding method steps; the
same connection method can appear in both flows.

- Nodes come parents first. `key` is the path of step keys joined with ` > `;
  `pctOf*` are percents (0-100). `dropoffN` / `dropoffPct` count sessions
  whose last observed step is this node; they do not establish that a user
  exited.
- `dropoffN` is sessions whose last observed step is that node. It is not a
  confirmed exit: a blocked tracker or an event outside the window reads the
  same. A node at `maxDepth` where `n - dropoffN - sum(children n)` is above
  zero has sessions that carried on.
- A session is an analytics session id. One that began before `dateFrom`
  starts mid-journey, so start the window a day early.
- Read `coverage` before using the numbers. `truncated: true` means the event
  read hit `maxEventRows` or the node list hit `maxNodes`; `notes` says which.
  Never report a truncated tree as the whole window.
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
visible. The token and replay events stay in memory; the CLI writes only PNGs
and `manifest.json` with `frames`, `failures` (explicit, with a reason), and
`skipped`. Manifest chunk counts and ordering must be complete; the CLI reads
bounded batches only through the requested offsets and validates every fetched
chunk. Fix failures or report them; do not paint over a missing frame.

Authenticate to the deployed app, never a local database: run
`npx -y @agent-native/core@latest connect https://analytics.agent-native.com --client codex`
(the CLI reads the bearer it writes to `~/.codex/config.toml`), or pass
`--token` / set `AGENT_NATIVE_TOKEN`. `--app-url` overrides the app. Frame mode
needs a deployment that includes `/sessions/:id?frame=1`.

Replay fetches use the recording-scoped token without app cookies or a referrer.
The capture browser stays offline while rendering untrusted replay DOM, so
remote images and fonts are not fetched. The output manifest marks this as
`remoteAssets: "not-fetched"`. Keep recorded URLs and CSS intact for rrweb
playback; network controls belong at the capture boundary. `--upload` stores
PNGs through the private upload action, which checks recording access again.

Viewport comes from the recording's first rrweb Meta event, stored by replay
ingest in `session_recordings.metadata.viewport` (`first` and `last`). Older
recordings have none.
