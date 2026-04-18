---
name: snippets
description: >-
  Pointer-only shareable moments — snippets reference a parent call plus
  [startMs, endMs] with no re-encode. Covers creation hotkeys (I/O/Enter),
  the snippet player with bounds enforcement, snippet sharing via the
  framework, and separate view counting. Use when wiring the clipper UI
  or the snippet player.
---

# Snippets

A snippet is a **pointer** into a call's timeline — a row with `call_id` + `[startMs, endMs]`. There is no second media file. The snippet player reads the parent call's bytes and enforces the bounds client-side. This keeps snippet creation instant, storage costs flat, and share links versioned against the canonical media.

## When to use

Read this skill before:

- Wiring the transcript selection → Create Snippet flow
- Building the snippet player at `/snippet/:id` or `/share-snippet/:id`
- Adding password / expiry to snippet shares
- Tracking snippet-level view counts separate from call views
- Debugging "why is the snippet playing past its end?"

## Data model

- **`snippets`** — `id`, `call_id`, `workspace_id`, `title`, `description`, `start_ms`, `end_ms`, `password`, `expires_at`, `owner_email`, `visibility` (from `ownableColumns()`), timestamps.
- **`snippet_shares`** — per-user / per-org share grants via framework `sharing`. Registered via `registerShareableResource({ type: "snippet", ... })` in `server/db/index.ts`.
- **`snippet_viewers`** — per-viewer stats, separate from `call_viewers`.

Snippets do NOT have their own transcript, participants, summary, or trackers — those are all derived from the parent call. The snippet player filters the parent's transcript to segments inside `[startMs, endMs]` and filters participants to those who spoke during the window.

## Creating a snippet

### Hotkeys

On the call page:

- `I` — mark In-point at the current playhead (or at the user's transcript-selection start).
- `O` — mark Out-point at the current playhead (or at the selection end).
- `Enter` — open the Create Snippet dialog prefilled with `[inMs, outMs]`.

`snippet-draft` in application state holds the in-progress `{ inMs, outMs, title }` so the agent can see them and offer help ("want me to title this?").

### Action

```bash
pnpm action create-snippet --callId=<id> --startMs=134000 --endMs=165000 --title="Pricing objection"
```

What happens:

1. `assertAccess("call", callId, "viewer")` — a viewer can snip.
2. Validate `startMs < endMs` and both within `calls.duration_ms` (if known).
3. Insert `snippets` row. `owner_email` = current user. `visibility` defaults to `private`.
4. Bump `refresh-signal`.
5. If no `title` provided (or title is "Untitled"), write a `auto-title-snippet-<id>` delegation to application state — the agent picks it up and calls `update-snippet` with a good title.

### Selection-aware creation

If the user has selected transcript text and presses Enter, the UI reads `transcript-selection` app-state (which carries `startMs`, `endMs`, `quote`) and uses those bounds instead of the I/O marks. This matches the "snip what I highlighted" intuition.

## The snippet player

### Playback bounds

The snippet player renders the parent call's media (`/api/call-media/<callId>` or the public URL) and enforces the window:

```ts
// Pseudo-code
const snippet = await getSnippet(id);
video.src = callMediaUrl(snippet.callId);
video.currentTime = snippet.startMs / 1000;

video.addEventListener("timeupdate", () => {
  if (video.currentTime * 1000 >= snippet.endMs) {
    video.pause();
    video.currentTime = snippet.startMs / 1000;   // loop back to start; UI offers replay
  }
});
```

Scrubbing is clamped — the scrub bar maps `0..1` onto `[startMs, endMs]`, so the user can never seek outside the window. Keyboard shortcuts (`←` / `→`, `J` / `L`) skip inside the window only.

### Transcript subset

`get-snippet-player-data` returns the parent call's transcript segments filtered to those that overlap `[startMs, endMs]`, with each segment's `startMs` rebased to snippet-local time (0-based). The agent uses the original call timeline; the UI shows snippet-local time.

## Sharing

Snippets use the framework sharing system, same as calls:

- **Visibility:** `set-resource-visibility --resourceType=snippet --resourceId=<id> --visibility=public` makes it viewable without auth.
- **Grants:** `share-resource --resourceType=snippet --resourceId=<id> --principalType=user --principalId=alice@example.com --role=viewer`.
- **Password / expiry:** `update-snippet --id=<id> --password=<pw> --expiresAt=<iso>`.

Public URLs:

- `/share-snippet/<snippetId>` — the standalone share page.
- `/embed-snippet/<snippetId>` — iframe-embeddable player.

Resolution goes through `/api/public-snippet` which applies:

1. Framework `resolveAccess("snippet", id, session)`.
2. Expiry check (non-owner).
3. Password check (non-owner).

Same order as calls — see the `call-sharing` skill.

## View counting

Snippets have **their own** viewer table. A snippet view does NOT count as a call view (otherwise a shared snippet would pollute call-level analytics).

`snippet_viewers` mirrors `call_viewers` shape and honors the same **≥ 5 seconds OR ≥ 75% completion OR scrubbed-to-end** rule. Since snippets are typically short, the `75%` threshold is usually the path that fires.

Events land in `call_events` with a `snippet_id` in the `payload` JSON — we share the event stream; the viewer-stats projection is what's distinct.

## Rules

- **Never re-encode.** The snippet is a pointer; the bytes are the parent call's. If someone proposes making snippets into their own MP4s, push back — that path is `stitch-recordings` in the `clips` template, a different product shape.
- **Bounds enforcement is client-side.** The server does not re-stream a windowed byte range. The player clamps `currentTime` and `seek`.
- **`startMs` / `endMs` are in the PARENT CALL's timeline** — do not convert to snippet-local on write. Convert on read when rendering the player.
- **Snippets of snippets are not allowed.** `snippets.callId` must point to a `calls` row, not another snippet.
- **Deleting the parent call** should soft-delete every snippet via a cascading trash. If a public snippet's parent call becomes private, the snippet's public URL still resolves (the snippet has its own visibility) — but the share UI should warn the user.
- **Separate view counter.** `snippet_viewers` is its own table; do not increment `call_viewers.totalWatchMs` from snippet playback.

## Related skills

- `call-sharing` — the same framework composition, with the password / expiry additions.
- `call-capture` — snippets reference a call, so the parent capture path must be working first.
- `call-summary` — the agent can propose snippets via `suggest-snippets` which writes to `call-suggested-snippets-<callId>` app-state.
- `sharing` — framework primitives snippets compose with.
- `real-time-sync` — `refresh-signal` covers snippet list invalidation too.
