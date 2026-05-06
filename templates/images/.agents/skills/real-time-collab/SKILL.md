---
name: real-time-collab
description: >-
  How to enable multi-user collaborative editing with Yjs CRDT, TipTap
  Collaboration extension, live cursors, and agent-driven edits.
---

# Real-Time Collaboration

The framework provides a Yjs-based collaborative editing system in `@agent-native/core/collab`. Multiple users can edit the same document simultaneously with live cursor positions, and the AI agent can make surgical edits that appear in real-time.

## Architecture

```
User A (TipTap + Collaboration ext)  ←→  Y.XmlFragment  ←→  Server (_collab_docs table)
User B (TipTap + Collaboration ext)  ←→  Y.XmlFragment  ←→       ↑
Agent (edit-document action)         ←→  search-replace endpoint ─┘
```

- **Yjs Y.Doc** stores the document as a `Y.XmlFragment` (ProseMirror node tree)
- **TipTap's Collaboration extension** binds the editor to the Y.XmlFragment via `ySyncPlugin`
- **CollaborationCaret extension** renders remote users' cursors with names and colors
- **Polling** (every 2s) syncs Y.Doc updates and awareness state between clients and server
- **SQL `_collab_docs` table** persists Yjs state (base64-encoded binary)

## Enabling Collaboration in a Template

### 1. Install dependencies

```bash
pnpm add @tiptap/extension-collaboration @tiptap/extension-collaboration-caret @tiptap/y-tiptap --filter your-template
```

### 2. Add Vite optimizeDeps

In `vite.config.ts`:
```ts
export default defineConfig({
  plugins: [reactRouter()],
  optimizeDeps: {
    include: [
      "yjs",
      "y-protocols/awareness",
      "@tiptap/extension-collaboration",
      "@tiptap/extension-collaboration-caret",
      "@tiptap/y-tiptap",
    ],
  },
});
```

This prevents Vite from re-bundling TipTap in incompatible ways during dev.

### 3. Add the collab server plugin

Create `server/plugins/collab.ts`:
```ts
import { createCollabPlugin } from "@agent-native/core/server";
export default createCollabPlugin({
  table: "your_table",
  contentColumn: "content",
  idColumn: "id",
  autoSeed: false, // Client-side seeding on first load
});
```

This mounts routes under `/_agent-native/collab/`:
- `GET /:docId/state` — fetch Y.Doc state
- `POST /:docId/update` — apply client update
- `POST /:docId/text` — apply full text (diff-based)
- `POST /:docId/search-replace` — surgical text find/replace in Y.XmlFragment
- `POST /:docId/awareness` — sync cursor/presence state

### 4. Use the `useCollaborativeDoc` hook

```ts
import { useCollaborativeDoc, generateTabId } from "@agent-native/core/client";

const TAB_ID = generateTabId();

const { ydoc, awareness, isLoading, activeUsers } = useCollaborativeDoc({
  docId: documentId,
  requestSource: TAB_ID,
  user: { name: "Steve", email: "steve@example.com", color: "#60a5fa" },
});
```

The hook:
- Creates a stable `Y.Doc` per docId (never changes identity)
- Fetches server state and applies it
- Sends local updates to server
- Polls for remote updates (every 2s)
- Tracks active users via awareness

### 5. Add Collaboration extension to TipTap

```ts
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { Awareness } from "y-protocols/awareness";

// Create awareness locally (must use same y-protocols as the caret extension)
const awareness = new Awareness(ydoc);
awareness.setLocalStateField("user", { name, color });

const editor = useEditor({
  extensions: [
    StarterKit.configure({ history: false }), // Disable history — Yjs handles undo
    Collaboration.configure({ document: ydoc }),
    CollaborationCaret.configure({
      provider: { awareness },
      user: { name, color },
    }),
    // ... other extensions
  ],
  content: initialContent, // Seeds Y.XmlFragment on first load
});
```

**Important:** Disable `history` in StarterKit when using Collaboration — Yjs handles undo/redo.

### 6. Seed the Y.XmlFragment

The Collaboration extension does NOT auto-seed from the `content` prop. You must seed manually:

```ts
useEffect(() => {
  if (!editor || !ydoc || !content) return;
  const fragment = ydoc.getXmlFragment("default");
  if (fragment.length === 0) {
    editor.commands.setContent(parseContent(content));
  }
}, [editor, ydoc, content]);
```

**Critical:** Guard against saving empty content back to SQL when the editor is in collab mode but hasn't been seeded yet:

```ts
onUpdate: ({ editor }) => {
  const md = editor.storage.markdown.getMarkdown();
  if (!md.trim() && ydoc) return; // Don't save empty during seeding
  onChange(md);
}
```

## Agent Edits via `edit-document`

The `edit-document` action uses search-and-replace:
```bash
pnpm action edit-document --id <docId> --find "old text" --replace "new text"
```

When collab state exists, the action calls the server's `search-replace` endpoint which:
1. Walks the Y.XmlFragment tree
2. Finds the text in Y.XmlText nodes
3. Applies minimal delete/insert operations
4. Emits a Yjs update via the poll system
5. Client receives the update → ySyncPlugin applies a targeted ProseMirror transaction → cursor preserved

**Important:** Actions run in a separate process, so they must use the HTTP endpoint (not the collab module directly) to emit updates to the server's poll system.

## Key Modules

| Module | Path | Purpose |
|--------|------|---------|
| `@agent-native/core/collab` | `packages/core/src/collab/` | Server-side Yjs management |
| `useCollaborativeDoc` | `packages/core/src/collab/client.ts` | Client hook |
| `createCollabPlugin` | `packages/core/src/server/collab-plugin.ts` | Route mounting |
| `searchAndReplace` | `packages/core/src/collab/ydoc-manager.ts` | Y.XmlFragment text mutation |

## Common Pitfalls

1. **TipTap version mismatch** — All `@tiptap/*` packages must be the same version. The Collaboration extension requires `editor.utils` which was added in v3.22.2.

2. **Empty editor on first load** — The Collaboration extension uses Y.XmlFragment as the source of truth. If the fragment is empty, the editor shows empty. Seed manually (see above).

3. **Data loss from empty saves** — The `onUpdate` handler fires when the editor initializes with an empty Y.XmlFragment. If this empty content is saved to SQL, it overwrites the real content. Always guard against saving empty content in collab mode.

4. **Stale content on document switch** — Use `key={documentId}` on the editor component to force a full remount when switching documents. This ensures the Y.Doc, seeding, and editor state are all fresh.

5. **Separate process for actions** — Actions run via `pnpm action` in a new Node.js process. The in-memory EventEmitter in the action process doesn't reach the dev server's poll system. Use HTTP endpoints for collab operations from actions.

6. **Vite dep optimization** — Adding Yjs-related packages to a template changes Vite's dependency bundling, which can break TipTap's React integration. Always add them to `optimizeDeps.include`.
