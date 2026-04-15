---
name: real-time-collab
description: >-
  Multi-user collaborative editing with Yjs CRDT and live cursors. Use when
  adding real-time collaborative editing to a template, debugging sync issues,
  or understanding how the agent and humans edit documents simultaneously.
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
2. **Agent edits** → `edit-document` action → server search-replace → Y.XmlFragment mutation → poll update → all clients

Both produce minimal Yjs operations that merge cleanly. Agent edits appear without destroying cursor position, selection, or undo history.

The `edit-document` action uses surgical search-and-replace on Y.XmlText nodes — more efficient than regenerating the entire document.

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
- **Don't use `editor.setContent()`** for agent edits — it bypasses Yjs and causes conflicts. Use the `search-replace` route or `edit-document` action.
- **Add packages to `optimizeDeps`** — Vite won't pre-bundle Yjs packages correctly otherwise, causing runtime errors in dev.
- **One `Y.Doc` per document** — Don't create multiple Y.Doc instances for the same document ID. Use the `useCollaborativeDoc` hook which caches by ID.

## Related Skills

- `real-time-sync` — Polling infrastructure that delivers Y.Doc updates
- `storing-data` — The `_collab_docs` table where Yjs state is persisted
- `self-modifying-code` — Agent edits to collaborative documents go through `edit-document`, not raw SQL
