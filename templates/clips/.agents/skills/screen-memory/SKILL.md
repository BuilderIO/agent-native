---
name: screen-memory
description: >-
  Screen Memory — the disabled-by-default, local-only desktop buffer of recent
  screen/app/window context, plus its status and query actions.
  Use when the user asks what was on screen recently, or when reading,
  exporting, enabling, or describing Screen Memory.
---

# Screen Memory

## Rule

Screen Memory is a disabled-by-default, local-only desktop buffer of recent
screen, app, and window context. Raw segments are never uploaded or shared, and
never describe Screen Memory as hosted, shared, exhaustive, or enabled by
default.

The one exception is an owner's explicit request for earlier screen time (see
below). Then a chosen window of Rewind history is uploaded as an owner-only
recording attached to one Clip. That Clip follows its normal share rules, and
sharing the Clip shares its earlier screen time with it. The rest of the buffer
stays local.

## Reading it from the in-app agent

1. Call `get-screen-memory-status` before relying on it at all.
2. Then call `query-screen-memory-context` for bounded recent snippets when
   local context files are present.

If the local Screen Memory MCP built-in is connected, the agent may also use
`screen_memory_status`, `screen_memory_recent_context`, and
`screen_memory_recent_segments`. Only inspect or export segment file paths when
the user explicitly asks.

## User control and external agents

Users enable, pause, export, and clear the buffer from the desktop tray
settings. External local agents can read recent app/window context through
`agent-native mcp screen-memory`.

Do not upload raw Screen Memory segments or treat them as shareable Clips unless
the user explicitly exports and imports them.

## Earlier screen time (lab)

Behind the `clips.lookback-context` lab (`CLIPS_LOOKBACK_CONTEXT`, on by
default). This only makes the option available: Rewind is off by default, and
the per-device lookback duration starts at `0` / Off. The user must enable
Rewind and choose a duration before earlier screen time is captured. When the
lab is off, do not offer this feature.

This is not Screen Memory. It is passive metadata on one clip: screen history
from before that recording started, attached to the clip as its own context.
The window is never stitched into the clip's video, and the clip's video is
unchanged. The older editor option that stitched Rewind history into the video
("Add what happened before") is removed. Do not offer it.

An item has two windows, both inside the 5 minutes before the recording
started:

- The original window (`originalStartedAt` / `originalEndedAt`) is the widest
  allowed, the last 5 minutes. It is fixed when the item is requested.
- The current window (`startedAt` / `endedAt`) is the part the owner selected.
  It starts as the last `requestedSeconds` (1 to 300) before the recording
  started. Any window inside the original, at least 1 second long, is allowed.

It follows its clip's normal share rules and nothing is special. Requesting it
does not change the clip's visibility. If the clip is public, shared with the
organization, or shared with people, the same viewers see the earlier screen
time: sharing the clip shares both as one bundle, and the clip's password and
expiry apply to it too. Only the owner can remove it. The request's `endedAt` may be up to 10 minutes after the Clip row
is created because native setup and the countdown happen after row creation. It
may be up to 120 seconds before row creation for client clock skew. Timestamps
outside those bounds fail with `recording_context_invalid_window`.

The footage is a separate recording owned by the clip owner, uploaded from this
device through the Rewind handoff. It stays owner-only by itself; viewers are
served it through the clip they can access, never by opening it directly. Its source app name is `Clips Rewind`; the footage check
refuses any other recording. The export handshake goes through
`update-recording-context`: `processing` claims the item and may name the
footage recording it created (`mediaRecordingId`); `ready` must name that same
recording, or it fails with `recording_context_footage_mismatch`; `failed`
releases the claim's footage. Changing the window returns the item to `pending`
and releases any reservation, and the desktop re-exports and uploads only the
new window. Removing the item trashes that footage recording and any footage an
export is still reserving.

The desktop editor builds a local preview of the original window with the
`rewind_preview_window` Tauri command, and deletes it with
`rewind_preview_discard`. The preview is never uploaded, and no action exposes
it.

On the web, the clip's Transcript tab shows the context above the transcript
when the lab is on and the clip has an item. Editing happens in the desktop app.

Read it with:

- `list-recording-context` (viewer access) returns the clip's active item: its
  window, `status` (`pending`, `processing`, `ready`, or `failed`), and any
  error. Removed items are excluded. Only a `ready` item has footage. A
  `pending` item captured on another device waits until that device saves it,
  because only that device can export its footage.
- `list-pending-recording-context` is for the desktop export worker, not for
  answering questions. It lists pending requests on clips the signed-in user
  owns. Pass `excludeIds[]` for items this device cannot process, so they do
  not hold up the batch.

Writes are owner-only: `request-recording-context`,
`update-recording-context`, `set-recording-context-window`, and
`remove-recording-context`. The desktop worker drives exports and status
changes. Change the window or remove the context only when the owner asks.

## Related skills

- `recording` — the hosted capture path Screen Memory is not part of.
- `security` — why local-only context stays local.
- `context-awareness` — the supported way the agent learns what is on screen
  inside Clips.
