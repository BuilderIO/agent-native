---
name: real-time-collab
description: >-
  Multi-user collaborative editing with Yjs CRDT, SSE fast-path transport, and
  granular server-side merge. Use when adding real-time collaborative editing to
  a template, debugging sync issues, or understanding how the agent and humans
  edit documents simultaneously.
scope: dev
metadata:
  internal: true
---

# Real-Time Collaboration

## Rule

Collaborative editing uses Yjs CRDT via TipTap. The agent and human users are
equal participants — both edit the same Y.Doc and changes merge cleanly without
conflicts. Always set `resourceType` on `createCollabPlugin`.

## How It Works

- **`Y.Doc`** stores the document as a `Y.XmlFragment` (ProseMirror node tree)
- **TipTap's Collaboration extension** binds the editor to the Y.XmlFragment
  via `ySyncPlugin`
- **CollaborationCaret extension** renders remote users' cursors with names and
  colors
- **SSE fast-path** — `/_agent-native/poll-events` `EventSource` delivers collab
  events push-style; while SSE is healthy the collab poll interval relaxes to
  ~12 s
- **Polling fallback** — `/_agent-native/poll` is polled every 2 s when SSE is
  unavailable; this is the universal serverless fallback
- **Update batching** — local Yjs updates are debounced ~80 ms and coalesced
  with `Y.mergeUpdates` before sending; flushed immediately on
  `visibilitychange` / `pagehide`
- **SQL `_collab_docs` table** persists Yjs state as base64 (SQLite/Postgres
  compatible). Tombstone compaction fires automatically when the stored blob
  exceeds 4× the fresh encoded size.

## Agent + Human Editing

1. **Human edits** → TipTap → ySyncPlugin → Y.XmlFragment → `POST /_agent-native/collab/:docId/update`
2. **Agent edits** → action edits canonical SQL content + bumps `updatedAt` → change-sync refetch → the open editor reconciles the new content into the live Y.Doc (see below) → poll update → all clients

Both produce Yjs operations that merge cleanly. Agent edits appear without
destroying cursor position, selection, or undo history.

The agent does **not** push edits into Yjs in-process and does **not** call any
localhost probe — those approaches silently no-op on serverless (the action runs
in a different process). The peer-editor model below replaced them.

## Agent Edits As A Real-Time Peer Editor

**SQL is the durable source of truth for document body content.** The agent
action edits the canonical content column and bumps `updatedAt`. No localhost
calls, no in-process Yjs mutation.

**The open editor reconciles authoritative external content into the live
Y.Doc.** The `updatedAt` bump flows through change-sync, which refetches the
record. The lead client applies the new content via `setContent`, producing Yjs
operations that merge with concurrent human edits. Every connected client
receives the result through normal Yjs sync.

### The `updatedAt` gate

```ts
// In the editor's reconcile effect
if (loaded.updatedAt > lastAppliedUpdatedAt.current) {
  applyAuthoritativeContent(loaded.content); // adopt
  lastAppliedUpdatedAt.current = loaded.updatedAt;
}
// else: lagging poll / stale snapshot → ignore
```

Without the gate, a slightly-behind poll response re-applies old content and
the edit "reverts on next poll". A fresh mount always adopts whatever content
it loaded.

### Lead-client election

Exactly ONE connected client applies the authoritative snapshot; the rest
receive it through Yjs sync:

```ts
import { isReconcileLeadClient } from "@agent-native/core/client";

if (
  loaded.updatedAt > lastAppliedUpdatedAt.current &&
  isReconcileLeadClient(awareness, ydoc.clientID)
) {
  applyAuthoritativeContent(loaded.content);
}
```

The agent's awareness entry (`AGENT_CLIENT_ID`, max int) can never be the
lead. A sole client is always the lead. The election is deterministic with no
coordination round-trip.

### v1 limitation

Full-content reconcile is **last-writer-wins** for the rare case where a human
has unsaved edits in the exact region the agent simultaneously rewrites. Edits
in **different** regions merge fine through the CRDT.

## Security

### Always set `resourceType`

```ts
// server/plugins/collab.ts
import { createCollabPlugin } from "@agent-native/core/server";

export default createCollabPlugin({
  table: "documents",
  contentColumn: "content",
  idColumn: "id",
  resourceType: "document", // required
});
```

Without `resourceType`, the server logs a one-time warning and collab push
events are delivered to **all authenticated users** without document-level
scoping. Set it to the resource type name registered via
`registerShareableResource`.

Non-owner sharees who have explicit access fall back to state-vector catch-up
(safe, slightly higher latency). Awareness routes require the same viewer
access as read routes.

### Payload limits

Write routes reject payloads exceeding `maxPayloadBytes` (default 2 MB) with
HTTP 413. Override:

```ts
createCollabPlugin({ resourceType: "document", maxPayloadBytes: 512 * 1024 });
```

## Enabling Collaboration

### 1. Install packages

```bash
pnpm add @tiptap/extension-collaboration @tiptap/extension-collaboration-caret @tiptap/y-tiptap @tiptap/core
```

### 2. Add collab server plugin (with `resourceType`)

```ts
// server/plugins/collab.ts
import { createCollabPlugin } from "@agent-native/core/server";

export default createCollabPlugin({
  table: "documents",
  contentColumn: "content",
  idColumn: "id",
  resourceType: "document",
});
```

### 3. Use the client hook

```ts
import { useCollaborativeDoc, emailToColor, emailToName } from "@agent-native/core/client";

const { ydoc, awareness, activeUsers, agentActive, agentPresent } =
  useCollaborativeDoc({
    docId: documentId,
    requestSource: TAB_ID,
    user: {
      name: emailToName(session.email),
      email: session.email,
      color: emailToColor(session.email),
    },
  });
```

### 4. Add TipTap extensions

```ts
import { Collaboration } from "@tiptap/extension-collaboration";
import { CollaborationCaret } from "@tiptap/extension-collaboration-caret";

const editor = useEditor({
  extensions: [
    StarterKit.configure({ history: false }), // Yjs handles undo
    Collaboration.configure({ document: ydoc }),
    CollaborationCaret.configure({
      provider: { awareness },
      user: { name: session.email, color: "#6366f1" },
    }),
  ],
  // Do NOT pass content — Yjs owns it
});
```

### 5. Add to vite.config.ts optimizeDeps

```ts
optimizeDeps: {
  include: [
    "yjs",
    "y-protocols/awareness",
    "@tiptap/core",
    "@tiptap/extension-collaboration",
    "@tiptap/extension-collaboration-caret",
    "@tiptap/y-tiptap",
  ],
}
```

## Collab Routes (auto-mounted)

| Route | Purpose |
| ----- | ------- |
| `GET /_agent-native/collab/:docId/state` | Fetch full Y.Doc state (accepts `?stateVector=` for diff) |
| `POST /_agent-native/collab/:docId/update` | Apply client Yjs update |
| `POST /_agent-native/collab/:docId/text` | Apply full text (diff-based) |
| `POST /_agent-native/collab/:docId/search-replace` | Surgical find/replace in Y.XmlFragment |
| `POST /_agent-native/collab/:docId/json` | Apply full JSON diff to Y.Map/Y.Array |
| `GET /_agent-native/collab/:docId/json` | Read current JSON state |
| `POST /_agent-native/collab/:docId/patch` | Surgical JSON patch ops |
| `POST /_agent-native/collab/:docId/awareness` | Sync cursor/presence state |
| `GET /_agent-native/collab/:docId/users` | List active users |

## Granular Server-Side Merge Pattern

For structured documents (slides, forms, design files) where body collab would
cause LWW conflicts at the container level, use **granular server-side merge**:
define an action with targeted per-item operations.

**When to use granular merge vs body collab:**

| Scenario | Recommended approach |
| -------- | -------------------- |
| Free-form rich text, cursor-level CRDT matters | Body collab (Y.XmlFragment + TipTap) |
| Structured items (slides, fields) where different users edit different items | Granular server-side merge (action with patch ops) |

Example operation shape for slides:

```ts
type PatchDeckOp =
  | { type: "patch"; slideId: string; fields: Partial<SlideFields> }
  | { type: "add"; position: number; slide: SlideData }
  | { type: "delete"; slideId: string }
  | { type: "reorder"; slideId: string; newIndex: number };
```

Concurrent edits to different slides both succeed at the action level; there
is no whole-deck LWW. Forms use the same shape with field-level ops.

## Agent Presence & Lingering Edit Highlights

The agent is a *visible* collaborator, not a silent content-swapper. Core
handles most of this automatically:

- **Auto-presence on agent writes** — any `applyText` / `searchAndReplace` /
  `applyJson` / `applyPatchOps` call with `requestSource: "agent"` publishes
  an agent awareness entry plus a `recentEdits` attribution describing what
  changed. Actions that route writes through the collab layer get full
  presence UX with zero extra wiring.
- **Linger** — `agentLeaveDocument` (and the auto-presence path) keeps the
  agent's awareness entry alive for ~6s (`AGENT_PRESENCE_LINGER_MS`) after the
  last edit so viewers see who just changed what. Pass `{ lingerMs: 0 }` to
  clear immediately. On serverless the linger degrades to the 30s awareness
  expiry.
- **`agentTouchDocument(docId, { edit, metadata })`** — refcount-neutral
  presence + attribution for actions that write SQL directly (no collab doc).
  `edit.descriptor` is one of `{kind:"text",quote}`, `{kind:"selector",selector}`,
  `{kind:"paths",paths}`, `{kind:"doc"}`.
- **Durable across instances** — awareness is mirrored to the additive
  `_collab_awareness` table, so presence written by an action in one
  serverless invocation is visible to clients polling any other instance.

Client rendering:

```tsx
import {
  usePresence, useRecentEdits, RecentEditHighlights,
  PresenceBar, LiveCursorOverlay, RemoteSelectionRings,
} from "@agent-native/core/client";

const { others, setPresence } = usePresence(awareness, ydoc?.clientID);
const recentEdits = useRecentEdits(others); // non-expired, ~6s TTL

<RecentEditHighlights
  edits={recentEdits}
  containerRef={containerRef}
  resolveRect={(edit) => /* map descriptor → DOMRect, or null */ null}
/>
```

Humans get the same treatment: call `publishRecentEdit(awareness, { descriptor })`
from local mutation paths so peers see lingering highlights for human edits
too. `CollabUser.avatarUrl` puts faces on avatars, cursors, and edit tags.

## Per-User Undo (never revert someone else's work)

Undo must only reverse the local user's edits — and must never restore a
whole-document snapshot (that clobbers concurrent edits by peers/the agent).
Core ships two primitives:

**Yjs surfaces — `useCollabUndo`** (wraps `Y.UndoManager` lifecycle):

```ts
import { useCollabUndo } from "@agent-native/core/client";

const { undo, redo, canUndo, canRedo, transactLocal, localOrigin } =
  useCollabUndo({
    ydoc,
    scope: (doc) => doc.getText("content"),
    captureTimeout: 500,
    enableKeyboardShortcuts: true, // Mod+Z / Shift+Mod+Z / Mod+Y
  });

// Tag every local mutation so it is captured:
transactLocal(() => { /* mutate shared types */ });
```

Remote (`"remote"`) and agent (`"agent"`/`"server"`) origins are never
captured. The manager is recreated/destroyed automatically when `ydoc`
changes. (TipTap's Collaboration extension already provides this behavior
for its own editor content.)

**Op-based surfaces (slides/forms) — `useLocalOpUndo`**: record inverse
granular ops for each local mutation; undo replays the inverse ops through
your normal granular mutation path:

```ts
const { push, undo, redo, canUndo, canRedo } = useLocalOpUndo({
  apply: (ops) => applyGranularOps(ops), // your patch path
});

push({
  undo: [{ type: "patch", slideId, fields: prevFields }],
  redo: [{ type: "patch", slideId, fields: nextFields }],
  coalesceKey: `${slideId}:content`, // merge rapid bursts into one step
});
```

Entries whose target no longer exists should fail soft (skip), never reset
the whole history — external/agent edits must not wipe the user's undo stack.

## Common Pitfalls

- **Missing `resourceType`** — The server logs a warning on startup and
  delivers collab events to all authenticated users without access scoping.
  Always set `resourceType`.
- **Don't pass `content` as a TipTap prop** when Collaboration is enabled —
  Yjs owns the content. Seed via `editor.commands.setContent()` only when the
  Y.XmlFragment is empty.
- **Don't call `editor.setContent()` ad hoc for agent edits** — the only
  sanctioned `setContent` is gated by `updatedAt` and guarded by
  `isReconcileLeadClient`. Calling it from elsewhere duplicates content across
  the CRDT or re-applies stale snapshots.
- **Add packages to `optimizeDeps`** — Vite won't pre-bundle Yjs correctly
  otherwise, causing runtime errors in dev.
- **One `Y.Doc` per document** — Don't create multiple Y.Doc instances for the
  same document ID. `useCollaborativeDoc` caches by ID.
- **Destroy Y.UndoManager on doc change** — Stale managers hold Y.Doc
  references and grow unboundedly. Recreate on `docId` change.

## Related Skills

- `real-time-sync` — The change-sync system that delivers the `updatedAt` bump
  driving editor reconciliation; also `useReconciledState` for non-Yjs surfaces
- `storing-data` — The `_collab_docs` table and SQL canonical content
- `security` — `registerShareableResource`, `resolveAccess`, `assertAccess`
- `self-modifying-code` — Agent edits to collaborative documents edit canonical
  SQL content, not raw Yjs
