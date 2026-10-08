---
name: onboarding-journeys
description: >-
  Build the onboarding journey tree (signup to first output, with % splits,
  drop-off per step, and example replays) and render a screenshot per step. Use
  when asked for an onboarding storyboard, where new users drop off, or frames
  for each onboarding step.
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

- Nodes come parents first. `key` is the path of step keys joined with ` > `;
  `pctOf*` are percents (0-100).
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
- Test identities are always excluded; `emailFilter` defaults to
  `exclude_builder`, as in the onboarding metrics. A session with any excluded
  identity is dropped whole.

## Capture

The CLI mints a two-hour tokenized replay link per recording with
`create-session-replay-agent-link`, opens each recording once in headless
Chromium at `/sessions/:id?frame=1&agent_access=...`, seeks to each `offsetMs`,
and uses the Sessions screenshot compositor. It writes `<nodeKey>-<n>.png` and
`manifest.json` with `frames`, `failures` (explicit, with a reason), and
`skipped`. Fix failures or report them; do not paint over a missing frame.

Authenticate to the deployed app, never a local database: run
`npx -y @agent-native/core@latest connect https://analytics.agent-native.com --client codex`
(the CLI reads the bearer it writes to `~/.codex/config.toml`), or pass
`--token` / set `AGENT_NATIVE_TOKEN`. `--app-url` overrides the app. Frame mode
needs a deployment that includes `/sessions/:id?frame=1`.

Frame mode renders without a login; the signed link is the only credential. It
masks and scrubs exactly as the Sessions viewer does. Do not add viewport
clamping or pointer projection to it (see `session-replay`).

Viewport comes from the recording's first rrweb Meta event, stored by replay
ingest in `session_recordings.metadata.viewport` (`first` and `last`). Older
recordings have none.
