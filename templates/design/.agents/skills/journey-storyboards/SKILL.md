---
name: journey-storyboards
description: >-
  Draw an onboarding-journey storyboard (a left-to-right tree of real session
  screenshots with arrows, fork percentages and last-observed-step stubs) on a
  Design canvas with one `create-journey-canvas` call. Use when you hold an
  Analytics journey tree plus captured frames and need the canvas, or when
  refreshing a storyboard drawn earlier.
---

# Journey storyboards

Call `create-journey-canvas` once. Never build the canvas by hand with
`create-design`, `generate-design` or `create-file` per card: the action lays out,
sizes and persists the whole tree in one transaction.

## Flow

1. `get-onboarding-journey` (Analytics) returns the cohort tree. Pass it through unchanged as `tree` unless you are adding a separately observed visual-reference chain.
2. Capture a frame for each example you want shown. Each frame is
   `{ nodeKey, exampleIndex, width, height, capturedAt }` plus exactly one of
   `imageUrl`, `attachmentRef`, or `stagedFrameId`. `exampleIndex` indexes `node.examples`; `width`
   and `height` are the image's real pixels. The card uses the matching example's
   event timestamp and recording id from the tree, separately from the
   screenshot's `capturedAt` time. Pass `recordingStartedAt` and the actual
   `screenshotOffsetMs` when known; replay observation time is derived only from
   those exact recording values. Analytics `example.offsetMs` includes a settle
   interval and is shown as a nominal checkpoint seek target, never used to
   infer recording start or replay observation time. For staged frames, pass
   `route` as the verified current route or explicit `null` when the replay
   export does not establish it. Never substitute the initial Meta href or
   derive the route from the journey node key. Pass `captureSourceFingerprint`
   when available and explicit `null` when it was not captured; its absence
   does not block an otherwise valid private screenshot.
   When a frame has reviewed context, add it to that frame's `caption`
   (`observedState` for the UI actually visible, `outputTitle`, recorded `actor`
   and `actorSource`, `dateLabel`,
      `evidenceStatus`, optional `evidenceAt` for a distinct source event time,
      and `prompt` when captured). The card shows the UTC
   timestamp, actor, and prompt preview; the full prompt opens in place. If the
   prompt is absent, say so with `promptUnavailableReason` instead of inferring
   it. Use the acting identity from recording metadata, never a storage-owner
   email. A card with multiple frames has keyboard-accessible numbered controls
   to switch examples without leaving the screen.
   A manually added chain observed in a separate session is not cohort data:
   mark each of its step nodes `referenceOnly: true` and omit `n`, `pctOfRoot`,
   `pctOfParent`, `dropoffN`, and `dropoffPct`. The card says
   `Observed session reference`; its cohort counts and percentages, incoming
   edge percentages, and drop-off stub are suppressed. Keep examples and frames
   paired by `exampleIndex` so chronological screenshots retain their event,
   recording, replay-offset, and capture-time provenance.
   To label observed order between two frames, use `observedContinuations` only
   for a direct parent edge whose destination is reference-only. The source may
   be a canonical cohort node only when `fromExampleIndex` selects that exact
   node example; this anchors the observed replay sequence without changing
   cohort counts or adding a cohort transition. Otherwise the source is also a
   reference-only node. Both private frames must bind to their selected examples
   from the same session and recording, with the same recording start and
   strictly increasing actual screenshot seek offsets. The dashed edge reads
   “Same recording” and has no cohort percentage. It describes replay order,
   not a causal transition.
   For exact examples from distinct recordings in the same session and app,
   use `observedRecordingGaps` instead of `observedContinuations`:
   `{ type: "recording-gap", fromNodeKey, fromExampleIndex, toNodeKey,
   toExampleIndex, gapDurationMs? }`. The destination must be a direct
   reference-only child. Bind both endpoints to private frames with exact
   `recordingStartedAt` values and actual `screenshotOffsetMs` seeks. Their
   `sessionId` values must match and their recording IDs must differ; when
   anonymous identity hashes are present, the `anonymousIdHash` values must
   match. The source frame must include `recordingEndedAt` before the target
   recording start, proving a recording gap even when duration is omitted.
   Pass `gapDurationMs` only when it exactly equals target recording start
   minus source recording end; values are bounded to 30 days. The edge is
   dashed and visibly says “Recording gap,” optionally with the duration. It
   preserves reference-only semantics and adds no cohort count, percentage,
   conversion, signup success, or authentication outcome. If authentication
   completion was not directly observed, keep it unknown. Unsupported or
   mismatched provenance is rejected.
   For large native-PNG imports, create the Design once, then call
   `stage-journey-canvas-frames` with a stable `importId` and batches of up to
   eight frames. Use the same stable `frameKey` (`nodeKey`, NUL, `exampleIndex`)
   and unchanged PNG bytes when retrying a batch; the action returns a
   `stagedFrameId` for each frame, and the final canvas call consumes those
   Design-owned blobs without copying them again. Keep each request below 5 MiB
   and split batches when the action reports `journey_stage_batch_too_large`.
   If an import is abandoned, call `discard-journey-canvas-frame-import` with
   its exact `designId` and `importId`; promoted storyboard frames are preserved.
3. `create-journey-canvas { title, tree, frames, locale }` returns
   `{ designId, url, nodeCount, frameCount, skippedNodes, collabSyncPending }`. Open `url`.
   A non-empty `collabSyncPending` means those files are saved but an open editor
   could not be updated live and may still show (and re-save) the previous
   version; call again with the same `designId` to retry the live sync.

Options: `designId` (refresh that design), `cardWidth` (default 360),
`maxExamplesPerNode` (default 3, at most 6), `includeScreenshotless` (default false).
Each call accepts at most 2,000 journey nodes and 900 frame entries, with a
256 MiB total screenshot-byte limit.
For independent app trees on one board, set `layoutMode: "appBands"`,
`tree.app: "all"`, app-prefixed node keys such as `clips::...`, and
`tree.appRootN` to the root denominator for each app. The layout places each
tree in its own side-by-side band, keeps edges within that app, and labels root
percentages against that app's denominator. It never adds app populations
together. The main role/setup path is placed at the top of its band before
independent route components; edges and cohort counts remain unchanged. The
default `layoutMode: "tree"` draws one tree or forest as before.
App-band percentages must match `n / appRootN[app]`; do not pass a global
denominator for per-app roots.
`locale` selects the translated labels inside each standalone storyboard card;
it defaults to `en-US`.
`allowEncryptedPublicUploadFallback` defaults to `false`; set it to `true` only
when this call is approved to store encrypted screenshot ciphertext with the
configured public-upload provider.

## Images

- `imageUrl` must be `https://`. `data:` URLs, other schemes and embedded credentials are rejected.
- `attachmentRef` is a personal private attachment. It is copied into opaque,
  encrypted private blob storage and served only to people who can view the
  design. A configured private blob provider is used by default. The encrypted
  public-upload fallback is used only when
  `allowEncryptedPublicUploadFallback: true` is passed and the fallback is
  configured; otherwise the call fails with `private_blob_provider_required`.
- `stagedFrameId` must be returned by `stage-journey-canvas-frames` for the same
  Design. It consumes the existing private blob handle and rejects missing,
  cross-Design, or mismatched-provenance rows.

## What you get

- Card height follows each frame's real aspect ratio (clamped to 0.5 to 2, letterboxed, never stretched or cropped). Extra examples stack behind the front card.
- Cards keep the event/replay UTC date, recorded actor, observed state, and prompt preview visible. Technical replay, source, route, capture, actor-source, and evidence metadata lives in a keyboard-accessible disclosure; the full prompt opens separately in place.
- A step with no frame is left off and listed in `skippedNodes`; its children re-attach to the nearest drawn ancestor with a dashed arrow and a recomputed percent. Tell the user which steps are missing instead of calling the storyboard complete.
- A neutral "No later step observed" stub shows the session count and
  percentage of that step for sessions whose last observed step is the node.
  This does not confirm that those sessions exited. `other` nodes are also
  neutral, screenshotless stubs. When Analytics provides `otherBranches`, the
  stub lists up to 20 full root-to-branch label paths with each branch's count
  and direct-parent percentage. `otherBranchCount` gives the full total, and a
  partial list says how many branches are shown. Older trees without branch
  detail say that the names are unavailable; do not reconstruct or invent them.
  Incoming edge labels wrap the full skipped-branch name and percentage on
  separate lines.
- Passing `designId` again replaces only what this action drew (ids start `jc_`, board objects `jc-`) and redraws in place. Other screens and board objects are untouched. A first draw goes below existing screens; board objects are not measured, so check for overlap on a board that already has shapes.
- If every node lacks a frame the call fails with `journey_canvas_empty` and lists them.
- If the design's board was edited while the call ran, it writes nothing and fails with `journey_board_changed`; call it again.
- Omitting `designId` creates a new design on every call, so do not blindly retry a call whose response was lost: look for the design first.
