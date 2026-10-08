---
name: journey-storyboards
description: >-
  Draw an onboarding-journey storyboard (a left-to-right tree of real session
  screenshots with arrows, fork percentages and drop-off stubs) on a Design
  canvas with one `create-journey-canvas` call. Use when you hold an Analytics
  journey tree plus captured frames and need the canvas, or when refreshing a
  storyboard drawn earlier.
---

# Journey storyboards

Call `create-journey-canvas` once. Never build the canvas by hand with
`create-design`, `generate-design` or `create-file` per card: the action lays out,
sizes and persists the whole tree in one transaction.

## Flow

1. `get-onboarding-journey` (Analytics) returns the tree. Pass it through unchanged as `tree`.
2. Capture a frame for each example you want shown. Each frame is
   `{ nodeKey, exampleIndex, width, height, capturedAt }` plus exactly one of
   `imageUrl` or `attachmentRef`. `exampleIndex` indexes `node.examples`; `width`
   and `height` are the image's real pixels.
3. `create-journey-canvas { title, tree, frames }` returns
   `{ designId, url, nodeCount, frameCount, skippedNodes, collabSyncPending }`. Open `url`.
   A non-empty `collabSyncPending` means those files are saved but an open editor
   could not be updated live and may still show (and re-save) the previous
   version; call again with the same `designId` to retry the live sync.

Options: `designId` (refresh that design), `cardWidth` (default 360),
`maxExamplesPerNode` (default 3, at most 6), `includeScreenshotless` (default false).

## Images

- `imageUrl` must be `https://`. `data:` URLs, other schemes and embedded credentials are rejected.
- `attachmentRef` is a personal private attachment. It is copied into Design's private
  blob storage and served only to people who can view the design. This needs private
  blob storage; without it the call fails with `private_blob_provider_required`.

## What you get

- Card height follows each frame's real aspect ratio (clamped to 0.5 to 2, letterboxed, never stretched or cropped). Extra examples stack behind the front card.
- A step with no frame is left off and listed in `skippedNodes`; its children re-attach to the nearest drawn ancestor with a dashed arrow and a recomputed percent. Tell the user which steps are missing instead of calling the storyboard complete.
- Each step with drop-off gets a red "X% dropped" stub; `other` nodes are neutral stubs.
- Passing `designId` again replaces only what this action drew (ids start `jc_`, board objects `jc-`) and redraws in place. Other screens and board objects are untouched. A first draw goes below existing screens; board objects are not measured, so check for overlap on a board that already has shapes.
- If every node lacks a frame the call fails with `journey_canvas_empty` and lists them.
- If the design's board was edited while the call ran, it writes nothing and fails with `journey_board_changed`; call it again.
- Omitting `designId` creates a new design on every call, so do not blindly retry a call whose response was lost: look for the design first.
