---
name: video-sharing
description: >-
  How Clips shares recordings — composes with the framework sharing skill and
  adds password, expiry, embed URLs, view-counting, and per-viewer "Viewed by"
  records. Use when wiring the share dialog, building embed links, adding a
  password, showing who viewed a clip and when, or debugging who can see a
  recording.
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
- Building AI-readable public clip URLs or transcript/frame endpoints
- Debugging "why can't Alice see this video?"
- Touching `server/routes/video/[id].ts` or `server/routes/share/[id].ts`

## Data model touched

- **`recordings.password`** (nullable text) — bcrypt hash.
- **`recordings.expires_at`** (nullable ISO string).
- **`recording_shares`** — framework-managed. Do not insert directly — use `share-resource`.
- **`recordings.visibility`** — framework-managed column from `ownableColumns()`.
- **`recording_viewers`** + **`recording_events`** — view counting.
- **`recording_views`** — append-only per-view log (who viewed, when) backing the owner-facing "Viewed by" popover. See "View counting" below.

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

## Slack unfurls

Clips can render Loom-style Slack previews through Slack App Unfurling. Configure
the Slack app's `link_shared` event to call `/api/slack/unfurl`; the route
verifies `SLACK_SIGNING_SECRET`, acknowledges Slack URL verification, and calls
`chat.unfurl` with a Block Kit `video` block using the existing `/embed/:id`
player URL.

For installable workspaces, use the Clips Settings OAuth flow. `connect-slack`
opens Slack OAuth, `/api/slack/oauth/callback` stores the bot token encrypted in
`app_secrets`, and `slack_installations` stores only the Slack team/app metadata
plus the secret ref. The unfurl webhook resolves the token by Slack `team_id`
and `api_app_id`; only if no OAuth install exists should it fall back to the
legacy `SLACK_BOT_TOKEN` path.

The playable Slack embed is deliberately narrower than the share page:

- Only `ready` recordings with `visibility === "public"` can produce a video block.
- Password-protected, expired, archived, trashed, private, org-only, or still-processing clips must not produce a playable Slack block.
- Slack thumbnails use the stored thumbnail (or animated thumbnail as fallback) and normal share-page metadata remains the fallback when no Slack app is installed.
- Do not put passwords, short-lived share tokens, raw provider URLs, or transcript text in Slack unfurl payloads.

Required Slack app setup:

- Bot scopes: `links:read`, `links:write`, `links.embed:write`
- Event subscription: `link_shared`
- App unfurl domains: the public Clips share domain, for example `clips.agent-native.com`
- Request URL: `https://<clips-host>/api/slack/unfurl`
- OAuth redirect URL: `https://<clips-host>/api/slack/oauth/callback`
- Deploy secrets: `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, and
  `SLACK_SIGNING_SECRET`

## Agent-readable clips

Recordings can expose URLs meant for external agents without handing over raw
video bytes:

| Endpoint | Meaning |
| -------- | ------- |
| `/api/agent-context.json?id=<recordingId>` | Clip metadata, transcript summary, recommended frames, and API discovery links |
| `/api/agent-transcript.json?id=<recordingId>` | Timestamped transcript segments with `startMs`, `endMs`, `timestamp`, `range`, `text`, and optional `source` |
| `/api/agent-frame.jpg?id=<recordingId>&atMs=<ms>` | JPEG frame extracted from the video at the requested original-video timestamp |

These endpoints follow the same access model as `/api/public-recording`, plus a
temporary agent-link path:

- Non-public clips return not found to anonymous callers.
- `create-recording-agent-link` resolves normal recording access, rejects
  archived or trashed recordings, then mints a two-hour `agent_access` URL for
  `/share/:recordingId`. The share page SSR advertises the agent context URL,
  and the JSON endpoints accept the same scoped token.
- Expired clips return expired.
- Password-protected clips require `password=<pw>` once; successful JSON
  responses include short-lived tokenized links so the plaintext password is not
  copied into downstream agent prompts, browser history, or logs.
- If the context or transcript response reports `transcript.status` as
  `"pending"`, wait 15-30 seconds and retry the context/transcript URL a few
  times before falling back to frames or telling the user no transcript exists.
- If transcription failed because Builder transcription credits are exhausted,
  tell the user to upgrade or connect Builder.io credits, or configure a Groq
  key for backup speech-to-text. Generic OpenAI or Anthropic chat keys do not
  transcribe Clips recordings.
- Frame extraction must use the checked recording media path and must not expose
  raw provider URLs.

The share popover's "Share with agents" field should copy an agent context URL
or tokenized share page URL, not raw transcript text. Its "Copy agent prompt"
field may wrap that URL with instructions to fetch transcripts, frames, and
browser diagnostics, but it should still point agents at the context response so
they can fetch only the visual context they need.

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

Events feeding this live in `recording_events`. The `/api/view-event` route receives `view-start`, `watch-progress` (every 5s), `seek`, `pause`, `resume`, `cta-click`, `reaction`. Aggregate into `recording_viewers` on write to keep `get-insights` fast.

### Per-viewer view records ("Viewed by")

On top of the aggregate `viewCount` shown in the library and the `views` stat in the insights panel, Clips records **individual view records** — who viewed a clip and when — so the owner can see a timeline, not just a number.

- **Table:** `recording_views` (`server/db/schema.ts`) — `id`, `recordingId`, `viewerId` (FK to `recording_viewers.id`), denormalized `viewerEmail` / `viewerName`, `viewedAt`. Append-only; never updated after insert.
- **Where it's written:** `server/routes/api/view-event.post.ts`, in the same handler that already upserts `recording_viewers` and inserts `recording_events`. A `recording_views` row is inserted **exactly once per viewer**, at the moment `countedView` transitions from `false` to `true` (i.e. the same instant that viewer starts contributing to the aggregate `views` count in `get-recording-insights`). This keeps the per-viewer log and the aggregate count always consistent — a returning viewer who is already counted does not create a second row.
- **Anonymous viewers** still get a row — `viewerEmail` is `null` and `viewerName` holds the `anon:<sessionId>` key, same convention as `recording_viewers`. The UI renders these as "Someone".
- **Read surface:** `list-clip-views` action — `{ recordingId, limit? }`, owner-only (`assertAccess("recording", recordingId, "editor")`), returns `{ views: [{ id, viewerEmail, viewerName, viewedAt }] }` sorted most-recent-first. Use this instead of scanning `recording_viewers`/`recording_events` when you need a real per-visit timeline.
- **UI:** clicking the view count (library card or the insights panel's Views stat) opens `<ViewedByPopover recordingId>` (`app/components/sharing/viewed-by-popover.tsx`), which lazily queries `list-clip-views` only while the popover is open.
- **Privacy:** viewer identities in `recording_views` are visible only to principals who already pass the owner-only `assertAccess` check on the recording — never surfaced on the public share page itself, which never fetches or renders other viewers' data.

## Anonymous viewers

`recording_viewers.viewer_email` is **nullable** — anonymous viewers (public link, no account) still get a row keyed by a cookie id. Never require login to watch a public recording; require it only when the share grant is user-scoped.

## Rules

- **Never** write to `recording_shares` directly. Always go through `share-resource` / `unshare-resource`.
- **Never** store a plaintext password. Use bcrypt on write; bcrypt-compare on read.
- **Never** bypass the access check on `/api/video/:id`. Streaming routes are the #1 data-leak vector.
- **Password + expiry are additions**, not replacements — the framework's `accessFilter` still runs first.
- The embed route (`/embed/:shareId`) is **anonymous by default** — don't require auth, but still go through `canAccess`.
- `build-embed-url` is the single source of truth for embed URLs — keep it in sync with the query params the player accepts.
- **Never** expose `recording_views` rows (or any other viewer's identity) from the public share/embed page — only `list-clip-views`, which is owner-only via `assertAccess`, may return them.

## Related skills

- `sharing` — framework-level primitive Clips composes with. Read this first.
- `security` — password handling, token storage, anonymous viewer cookies.
- `video-editing` — exports honor `recordings.enableDownloads`.
- `storing-data` — why `password` / `expiresAt` live on the `recordings` row instead of a parallel table.
