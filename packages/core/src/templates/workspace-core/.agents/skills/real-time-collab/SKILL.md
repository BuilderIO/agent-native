---
name: real-time-collab
description: >-
  Multi-user collaborative editing with Yjs CRDT and live cursors. Use when
  adding real-time collaborative editing to a template, debugging sync issues,
  or understanding how the agent and humans edit documents simultaneously.
metadata:
  internal: true
---

# Real-Time Collaboration

## Rule

Collaborative editing uses Yjs CRDT via TipTap. The agent and human users are equal participants — both edit the same Y.Doc and changes merge cleanly without conflicts.

## How It Works

- **`Y.Doc`** stores the document as a `Y.XmlFragment` (ProseMirror node tree)
- **TipTap's Collaboration extension** binds the editor to the Y.XmlFragment via `ySyncPlugin`
- **CollaborationCaret extension** renders remote users' cursors with names and colors
- **Polling** (every 2s) syncs Y.Doc updates and awareness state between clients and server
- **SQL `_collab_docs` table** persists Yjs state as base64-encoded binary (works across SQLite/Postgres)

## Agent + Human Editing

1. **Human edits** → TipTap → ySyncPlugin → Y.XmlFragment → `POST /_agent-native/collab/:docId/update`
2. **Agent edits** → action edits canonical SQL content + bumps `updatedAt` → change-sync refetch → the open editor reconciles the new content into the live Y.Doc (see below) → poll update → all clients

Both produce Yjs operations that merge cleanly. Agent edits appear without destroying cursor position, selection, or undo history.

This is how content (documents) and slides now work. The agent does **not** push edits into Yjs in-process, and it does **not** call any `findCollabOrigin()` / localhost probe — that approach silently no-op'd on serverless (the action runs in a different process), so agent edits didn't show up live until the user navigated away and back. Nor does it search-and-replace inside existing Y.XmlText nodes, which could never create new block structure (lists, headings, tables). The peer-editor model below replaces both.

## Agent Edits As A Real-Time Peer Editor

The agent edits documents the same way a human collaborator does: its change lands in the shared Y.Doc, propagates to every connected client, and persists. It gets there without any in-process Yjs push from the action.

**SQL is the durable source of truth for document body content.** The agent action edits the canonical content (e.g. `documents.content`) and bumps `updatedAt`. That's the whole server side — no localhost calls, no Yjs mutation from the action.

**The open editor reconciles authoritative external content into the live Y.Doc.** The action's `updatedAt` bump flows through the change-sync system (see `real-time-sync`), which refetches the record. The editor applies the new content through its real markdown/HTML pipeline via `setContent`, so new block structure (lists, headings, tables) renders correctly and merges with concurrent human edits through the Yjs CRDT diff. The result: the agent's edit propagates to every connected client and persists, exactly like a human collaborator's edit.

### The `updatedAt` gate

The editor only adopts content that is genuinely **newer** than what it already reflects. An older-or-equal `updatedAt` is a lagging poll or a stale snapshot and is **ignored**.

```ts
// Pseudocode in the editor's reconcile effect
if (loaded.updatedAt > lastAppliedUpdatedAt.current) {
  applyAuthoritativeContent(loaded.content); // adopt
  lastAppliedUpdatedAt.current = loaded.updatedAt;
}
// else: lagging poll / stale snapshot → ignore
```

**Why:** without the gate, a slightly-behind poll response re-applies old content right after the agent's edit, so the edit "reverts on the next poll" / "doesn't show until refresh" — the whack-a-mole we kept hitting. A **fresh mount or doc-switch has no baseline**, so it always adopts whatever content it loaded — which is why a manual refresh is always correct.

### Lead-client election

Exactly ONE connected client applies an authoritative snapshot into the shared Y.Doc; the rest receive it through normal Yjs sync. The lead is the present client with the lowest Yjs `clientID`, decided by the core helper:

```ts
import { isReconcileLeadClient } from "@agent-native/core/client";

if (
  loaded.updatedAt > lastAppliedUpdatedAt.current &&
  isReconcileLeadClient(provider.awareness, ydoc.clientID)
) {
  applyAuthoritativeContent(loaded.content);
}
```

**Why:** if every open editor independently diffed the same snapshot into the CRDT, each would insert the changed region at the same position, duplicating it N times (concurrent inserts → duplicated text). Electing one lead avoids that. The agent's awareness id (`AGENT_CLIENT_ID`, max int) can never win, and a client editing alone is always the lead. The election is deterministic across clients with no coordination round-trip.

### v1 limitation

A full-content reconcile is **last-writer-wins for the rare case** where a human has unsaved edits in the exact region the agent simultaneously rewrites — the agent's snapshot can clobber that in-flight human edit. Inline and structural edits in **different** regions merge fine through the CRDT; only same-region simultaneous rewrites are at risk.

## Enabling Collaboration

### 1. Install packages

```bash
pnpm add @tiptap/extension-collaboration @tiptap/extension-collaboration-caret @tiptap/y-tiptap
```

### 2. Add collab server plugin

```ts
// server/plugins/collab.ts
import { createCollabPlugin } from "@agent-native/core/collab";

export default createCollabPlugin({
  table: "documents",
  contentColumn: "content",
  idColumn: "id",
});
```

### 3. Use the client hook

```ts
import { useCollaborativeDoc } from "@agent-native/core/client";

const { ydoc, provider } = useCollaborativeDoc(documentId);
```

### 4. Add TipTap extensions

```ts
import { Collaboration } from "@tiptap/extension-collaboration";
import { CollaborationCaret } from "@tiptap/extension-collaboration-caret";

const editor = useEditor({
  extensions: [
    Collaboration.configure({ document: ydoc }),
    CollaborationCaret.configure({
      provider,
      user: { name: session.email, color: "#6366f1" },
    }),
  ],
});
```

### 5. Add to vite.config.ts optimizeDeps

```ts
optimizeDeps: {
  include: [
    "@tiptap/extension-collaboration",
    "@tiptap/extension-collaboration-caret",
    "@tiptap/y-tiptap",
  ],
}
```

## Collab Routes (auto-mounted)

| Route | Purpose |
| ----- | ------- |
| `GET /_agent-native/collab/:docId/state` | Fetch full Y.Doc state |
| `POST /_agent-native/collab/:docId/update` | Apply client Yjs update |
| `POST /_agent-native/collab/:docId/text` | Apply full text (diff-based) |
| `POST /_agent-native/collab/:docId/search-replace` | Surgical find/replace in Y.XmlFragment |
| `POST /_agent-native/collab/:docId/awareness` | Sync cursor/presence state |
| `GET /_agent-native/collab/:docId/users` | List active users |

## Common Pitfalls

- **Don't pass `content` as a TipTap prop** when Collaboration is enabled — Yjs owns the content. Set initial content via the Y.Doc instead.
- **Don't call `editor.setContent()` ad hoc for agent edits.** The only sanctioned `setContent` is the editor's reconcile path described above — gated by `updatedAt` and guarded by `isReconcileLeadClient`. Calling it from elsewhere (e.g. on every poll, or from every client) re-applies stale content or duplicates the changed region across the CRDT.
- **Add packages to `optimizeDeps`** — Vite won't pre-bundle Yjs packages correctly otherwise, causing runtime errors in dev.
- **One `Y.Doc` per document** — Don't create multiple Y.Doc instances for the same document ID. Use the `useCollaborativeDoc` hook which caches by ID.

## Related Skills

- `real-time-sync` — The change-sync system that delivers the `updatedAt` bump driving editor reconciliation; also `useReconciledState` for non-collaborative "copy a server value into local edit state" surfaces
- `storing-data` — The `_collab_docs` table where Yjs state is persisted; SQL holds the canonical document body that the editor reconciles from
- `self-modifying-code` — Agent edits to collaborative documents edit canonical SQL content, not raw Yjs
