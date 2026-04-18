---
name: video-sharing
description: >-
  How Clips shares recordings — composes with the framework sharing skill and
  adds password, expiry, embed URLs, and view-counting. Use when wiring the
  share dialog, building embed links, adding a password, or debugging who can
  see a recording.
---

# Video Sharing

## Rule

Recording sharing uses the framework `sharing` system — not a custom share table. Recordings are registered via `registerShareableResource({ type: "recording", ... })` in `server/db/index.ts`. The `share-resource`, `unshare-resource`, `list-resource-shares`, and `set-resource-visibility` actions are auto-mounted and handle per-user grants, per-org grants, and the three visibility levels (`private` / `org` / `public`).

Clips **adds two things** on top of the framework system:

1. **Password** — an optional bcrypt'd string on the `recordings` row. When set, all non-owner viewers must enter it to play the recording.
2. **`expiresAt`** — an optional ISO timestamp on the `recordings` row. After this time, all non-owner access is denied (even to principals with explicit grants).

These are **additive** — they never grant access the framework denies, only tighten it.

## When to use

Read this skill before:

- Wiring the Share dialog on a recording page
- Adding a password or expiry UI
- Building embed URLs (`?t=`, `?autoplay=`, `?hideControls=`)
- Debugging "why can't Alice see this video?"
- Touching `server/routes/video/[id].ts` or `server/routes/share/[id].ts`

## Data model touched

- **`recordings.password`** (nullable text) — bcrypt hash.
- **`recordings.expires_at`** (nullable ISO string).
- **`recording_shares`** — framework-managed. Do not insert directly — use `share-resource`.
- **`recordings.visibility`** — framework-managed column from `ownableColumns()`.
- **`recording_viewers`** + **`recording_events`** — view counting.

## Dropping in the share UI

Clips' `app/components/player/share-dialog.tsx` is a **thin wrapper around the framework `ShareDialog`** from `@agent-native/core/client`. The framework component handles per-user / per-org grants, visibility, and tabbed copy-link / embed UI — Clips just composes it with recording-specific extras.

```tsx
import { ShareDialog } from "@agent-native/core/client";

<ShareDialog
  resourceType="recording"
  resourceId={recording.id}
  resourceTitle={recording.title}
  shareUrl={`${origin}/share/${recording.id}`}
  embedUrl={`${origin}/embed/${recording.id}`}
  linkTabExtras={
    <>
      {/* Password + expiry render in the Link tab, below the share URL. */}
      <PasswordField recordingId={recording.id} />
      <ExpiryField recordingId={recording.id} />
    </>
  }
  embedTabContent={<EmbedSnippetAndOptions recordingId={recording.id} />}
/>
```

- `shareUrl` / `embedUrl` — the copy-link and embed URLs the framework renders in its tabs.
- `linkTabExtras` — Clips-specific controls (password, expiry) shown beneath the link.
- `embedTabContent` — full replacement for the Embed tab body (embed code, params like `?t=`, `?autoplay=`).

The password and expiry fields call `update-recording --password=...` / `--expiresAt=...`. Keep Clips' share-dialog wrapper minimal — any new generic sharing feature belongs in the framework component, not here.

## Access resolution

The player and `/api/video/:id` route check access in this exact order:

```ts
async function canAccess(
  recordingId: string,
  requester: Session | null,
  providedPassword?: string,
) {
  // 1. Framework check — owner, shared, or meets visibility.
  const access = await resolveAccess("recording", recordingId, requester);
  if (!access.allowed) return false;

  const rec = await getRecordingOrThrow(recordingId);

  // 2. Expiry — non-owner only.
  if (rec.expiresAt && requester?.email !== rec.ownerEmail) {
    if (new Date(rec.expiresAt) < new Date()) return false;
  }

  // 3. Password — non-owner only.
  if (rec.password && requester?.email !== rec.ownerEmail) {
    if (!providedPassword) return false;
    if (!(await bcrypt.compare(providedPassword, rec.password))) return false;
  }

  return true;
}
```

Framework first, Clips additions second. Don't invert this — the framework owns the "is this row visible at all" question.

## Embed URLs

Embeds live at `/embed/:shareId` (a share-scoped anonymous route). Supported query params:

| Param             | Meaning                                            |
| ----------------- | -------------------------------------------------- |
| `?t=80`           | Start playback at 80 seconds                       |
| `?autoplay=1`     | Autoplay (muted — browsers block unmuted autoplay) |
| `?hideControls=1` | Hide the player chrome                             |
| `?loop=1`         | Loop playback                                      |

Build embed URLs via the `build-embed-url` action:

```ts
const { url } = await callAction("build-embed-url", {
  id: recording.id,
  t: 80,
  autoplay: true,
});
// -> /embed/<shareId>?t=80&autoplay=1
```

## View counting

A view counts when **any** of these is true:

- The viewer has watched **≥ 5 seconds** of total real playback time
- The viewer has hit **≥ 75% completion**
- The viewer has scrubbed to the very end

The canonical predicate is `shouldCountView(totalWatchMs, completedPct, scrubbedToEnd)` from `server/lib/recordings.ts`. Always go through it — do not recompute inline.

```ts
import { shouldCountView } from "../server/lib/recordings.js";

if (
  !viewer.countedView &&
  shouldCountView(viewer.totalWatchMs, viewer.completedPct, scrubbedToEnd)
) {
  await db
    .update(schema.recordingViewers)
    .set({ countedView: true })
    .where(eq(schema.recordingViewers.id, viewer.id));
}
```

Events feeding this live in `recording_events`. The `/api/view-events` route receives `view-start`, `watch-progress` (every 5s), `seek`, `pause`, `resume`, `cta-click`, `reaction`. Aggregate into `recording_viewers` on write to keep `get-insights` fast.

## Anonymous viewers

`recording_viewers.viewer_email` is **nullable** — anonymous viewers (public link, no account) still get a row keyed by a cookie id. Never require login to watch a public recording; require it only when the share grant is user-scoped.

## Rules

- **Never** write to `recording_shares` directly. Always go through `share-resource` / `unshare-resource`.
- **Never** store a plaintext password. Use bcrypt on write; bcrypt-compare on read.
- **Never** bypass the access check on `/api/video/:id`. Streaming routes are the #1 data-leak vector.
- **Password + expiry are additions**, not replacements — the framework's `accessFilter` still runs first.
- The embed route (`/embed/:shareId`) is **anonymous by default** — don't require auth, but still go through `canAccess`.
- `build-embed-url` is the single source of truth for embed URLs — keep it in sync with the query params the player accepts.

## Related skills

- `sharing` — framework-level primitive Clips composes with. Read this first.
- `security` — password handling, token storage, anonymous viewer cookies.
- `video-editing` — exports honor `recordings.enableDownloads`.
- `storing-data` — why `password` / `expiresAt` live on the `recordings` row instead of a parallel table.
