---
name: call-sharing
description: >-
  How Calls shares calls and snippets — composes with the framework sharing
  skill and adds password, expiry, shareIncludesSummary, shareIncludesTranscript,
  embed URLs, and view counting. Use when wiring the share dialog, building
  embeds, adding a password, or debugging who can see a call.
---

# Call Sharing

## Rule

Call and snippet sharing uses the framework `sharing` system — not a custom share table. Calls and snippets are registered via:

```ts
// server/db/index.ts
registerShareableResource({ type: "call", table: calls, sharesTable: callShares, ... });
registerShareableResource({ type: "snippet", table: snippets, sharesTable: snippetShares, ... });
```

This wires up the auto-mounted `share-resource`, `unshare-resource`, `list-resource-shares`, and `set-resource-visibility` actions. They handle per-user grants, per-org grants, and the three visibility levels (`private` / `org` / `public`).

On top of the framework, Calls adds four things:

1. **Password** — an optional bcrypt'd string on the `calls` / `snippets` row. Non-owner viewers must enter it to play.
2. **`expiresAt`** — an optional ISO timestamp. After this time, non-owner access is denied.
3. **`shareIncludesSummary`** — boolean on `calls`. When false, the public share page hides the AI summary.
4. **`shareIncludesTranscript`** — boolean on `calls`. When false, the public share page hides the transcript.

These are **additive** — they never grant access the framework denies, only tighten it or hide sub-resources.

## When to use

Read this skill before:

- Wiring the Share dialog on a call or snippet page
- Adding password, expiry, or summary / transcript visibility toggles
- Building embed URLs (`?t=`, `?autoplay=`, `?hideControls=`)
- Debugging "why can't Alice see this call?"
- Touching `server/routes/api/public-call.get.ts` or `server/routes/api/public-snippet.get.ts`

## Data model touched

- **`calls.password`** (nullable) — bcrypt hash.
- **`calls.expires_at`** (nullable ISO string).
- **`calls.share_includes_summary`** (boolean, default true).
- **`calls.share_includes_transcript`** (boolean, default false).
- **`call_shares`** — framework-managed. Do not insert directly.
- **`calls.visibility`** — framework-managed column from `ownableColumns()`.
- **`call_viewers`** + **`call_events`** — view counting.
- Snippets mirror all of the above in `snippets` / `snippet_shares` / `snippet_viewers` (no per-field summary/transcript toggles — snippets are always a single moment).

## Dropping in the share UI

```tsx
import { ShareButton } from "@agent-native/core/client";

<ShareButton
  resourceType="call"
  resourceId={call.id}
  resourceTitle={call.title}
>
  {/* Calls-specific extras slot inside the dialog */}
  <PasswordField callId={call.id} />
  <ExpiryField callId={call.id} />
  <SwitchField
    label="Include AI summary on public page"
    value={call.shareIncludesSummary}
    onChange={(v) => update({ id: call.id, shareIncludesSummary: v })}
  />
  <SwitchField
    label="Include full transcript on public page"
    value={call.shareIncludesTranscript}
    onChange={(v) => update({ id: call.id, shareIncludesTranscript: v })}
  />
</ShareButton>
```

All four extras call `update-call` with the relevant fields.

## Access resolution

The player and `/api/public-call` route check access in this exact order:

```ts
async function canAccessCall(callId: string, requester: Session | null, providedPassword?: string) {
  // 1. Framework check — owner, shared, or meets visibility.
  const access = await resolveAccess("call", callId, requester);
  if (!access.allowed) return false;

  const call = await getCallOrThrow(callId);

  // 2. Expiry — non-owner only.
  if (call.expiresAt && requester?.email !== call.ownerEmail) {
    if (new Date(call.expiresAt) < new Date()) return false;
  }

  // 3. Password — non-owner only.
  if (call.password && requester?.email !== call.ownerEmail) {
    if (!providedPassword) return false;
    if (!(await bcrypt.compare(providedPassword, call.password))) return false;
  }

  return true;
}
```

Framework first, Calls additions second. Don't invert this — the framework owns the "is this row visible at all" question. Same logic applies to snippets against `call_shares` → `snippet_shares` and the snippet's own `password` / `expiresAt`.

## Public URLs

| URL                              | What it renders                                                         |
| -------------------------------- | ----------------------------------------------------------------------- |
| `/share/<callId>`                | Public call page — player + (optional) summary + (optional) transcript. |
| `/embed/<callId>`                | Iframe-embeddable player (no chrome).                                   |
| `/share-snippet/<snippetId>`     | Public snippet page — player clamped to `[startMs, endMs]`.             |
| `/embed-snippet/<snippetId>`     | Iframe-embeddable snippet player.                                       |

All four require `visibility=public` on the underlying row or an explicit per-user share grant.

## Embed URL params

| Param              | Meaning                                                  |
| ------------------ | -------------------------------------------------------- |
| `?t=80`            | Start playback at 80 seconds                             |
| `?autoplay=1`      | Autoplay (muted — browsers block unmuted autoplay)       |
| `?hideControls=1`  | Hide the player chrome                                   |
| `?loop=1`          | Loop playback                                            |
| `?showTranscript=1` | Show transcript below player (call embed only)          |
| `?showSummary=1`   | Show summary below player (call embed only)              |

Snippet embeds do not honor `showTranscript` / `showSummary` — they're a single moment.

## View counting

A view counts when **any** of these is true:

- The viewer has watched **≥ 5 seconds** of total real playback time
- The viewer has hit **≥ 75% completion**
- The viewer has scrubbed to the very end

The canonical predicate is `shouldCountView(totalWatchMs, completedPct, scrubbedToEnd)` — live in `server/lib/calls.ts`. Always go through it.

```ts
if (!viewer.countedView && shouldCountView(viewer.totalWatchMs, viewer.completedPct, scrubbedToEnd)) {
  await db.update(schema.callViewers)
    .set({ countedView: true })
    .where(eq(schema.callViewers.id, viewer.id));
}
```

Events feeding this live in `call_events`. The `POST /api/view-events` route receives `view-start`, `watch-progress` (every 5s), `seek`, `pause`, `resume`, `reaction`. Aggregate into `call_viewers` on write to keep `get-call-insights` fast.

Snippet view counting uses `snippet_viewers` — see the `snippets` skill. Call views are not incremented by snippet playback.

## Anonymous viewers

`call_viewers.viewer_email` is **nullable** — anonymous viewers (public link, no account) still get a row keyed by a cookie id carried in `viewerName`. Never require login to watch a public call; require it only when the share grant is user-scoped.

## Rules

- **Never** write to `call_shares` / `snippet_shares` directly. Always go through `share-resource` / `unshare-resource`.
- **Never** store a plaintext password. Use bcrypt on write; bcrypt-compare on read.
- **Never** bypass the access check on `/api/call-media/:callId` or `/api/snippet-media/:snippetId`. Streaming routes are the #1 data-leak vector.
- **Password + expiry + summary/transcript flags are additions** — they never grant access the framework denies. Framework `accessFilter` runs first.
- **Embed routes are anonymous by default** — don't require auth, but still go through `canAccessCall`.
- **`shareIncludesSummary` / `shareIncludesTranscript` are render-time flags** — the API doesn't strip the data, the public page just hides the panel. Do not use these to gate the `/api/public-call` response shape, or the agent won't be able to answer "what's in this call?" for the owner.

## Related skills

- `sharing` — framework-level primitive Calls composes with. Read this first.
- `snippets` — snippet-specific sharing rules and the pointer-only playback model.
- `security` — password handling, token storage, anonymous viewer cookies.
- `storing-data` — why `password` / `expiresAt` / `shareIncludes*` live on the `calls` row instead of a parallel table.
