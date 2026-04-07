---
title: "Real-Time Collaboration"
description: "Multi-user collaborative editing with Yjs CRDT, live cursors, and AI agent real-time edits."
---

# Real-Time Collaboration

Multi-user collaborative editing where the AI agent and human users are equal participants — like Google Docs, but with an AI collaborator.

## Overview {#overview}

The framework provides a Yjs-based collaborative editing system in `@agent-native/core/collab`. Multiple users can edit the same document simultaneously with live cursor positions, and the AI agent can make surgical edits that appear in real-time without disrupting the user's cursor, selection, or undo history.

This is built on three battle-tested technologies: **Yjs** (CRDT for conflict-free merging), **TipTap** (rich text editor), and **polling-based sync** (works in all deployment environments including serverless and edge).

## How it works {#how-it-works}

The collaboration system has three layers:

- **Yjs Y.Doc** — stores the document as a `Y.XmlFragment` (ProseMirror node tree). This is the CRDT that enables conflict-free merging of concurrent edits.
- **TipTap Collaboration extension** — binds the editor to the Y.XmlFragment via `ySyncPlugin`. Remote changes are applied as minimal ProseMirror transactions that preserve cursor position.
- **Polling sync** — clients poll `/_agent-native/poll` every 2 seconds for Yjs updates. Awareness state (cursor positions, user info) is synced via a separate `/_agent-native/collab/:docId/awareness` endpoint.

The Yjs state is persisted in a `_collab_docs` SQL table as base64-encoded binary, compatible with both SQLite and Postgres.

## Agent + human collaboration {#agent-human-collab}

The agent and human users are equal participants in collaborative editing. The key insight is that both produce Yjs operations that merge cleanly:

- **Human edits** flow through TipTap → ySyncPlugin → Y.XmlFragment → server via HTTP
- **Agent edits** flow through the `edit-document` action → server search-replace endpoint → Y.XmlFragment mutation → poll update → all clients

The agent's `edit-document` action uses surgical search-and-replace on Y.XmlText nodes within the Y.XmlFragment tree. This produces the smallest possible Yjs update — only the changed text is modified, not the entire document. The result: the user sees the agent's change appear in their editor without losing their place.

```bash
# Agent makes a surgical edit — user sees it appear live
pnpm action edit-document --id doc123 --find "Big Projects" --replace "Proyectos Grandes"

# The action:
# 1. Updates SQL content column (for search/API compat)
# 2. Calls POST /_agent-native/collab/doc123/search-replace
# 3. Server walks Y.XmlFragment, finds text, modifies Y.XmlText node
# 4. Minimal Yjs update emitted via poll system
# 5. Client receives update → ySyncPlugin applies targeted PM transaction
# 6. User's cursor stays in place ✓
```

## Enabling collaboration {#enabling-collab}

Templates opt into collaboration with five steps:

### 1. Install dependencies

```bash
pnpm add @tiptap/extension-collaboration @tiptap/extension-collaboration-caret @tiptap/y-tiptap @tiptap/core
```

### 2. Add Vite optimizeDeps

Prevents Vite from re-bundling TipTap in incompatible ways during dev:

```typescript
// vite.config.ts
export default defineConfig({
  plugins: [reactRouter()],
  optimizeDeps: {
    include: [
      "yjs", "y-protocols/awareness",
      "@tiptap/core", "@tiptap/extension-collaboration",
      "@tiptap/extension-collaboration-caret", "@tiptap/y-tiptap",
    ],
  },
});
```

### 3. Add the collab server plugin

```typescript
// server/plugins/collab.ts
import { createCollabPlugin } from "@agent-native/core/server";

export default createCollabPlugin({
  table: "documents",
  contentColumn: "content",
  idColumn: "id",
  autoSeed: false, // Client-side seeding on first load
});
```

### 4. Use the client hook

```typescript
import { useCollaborativeDoc, generateTabId } from "@agent-native/core/client";

const TAB_ID = generateTabId();

const { ydoc, awareness, isLoading, activeUsers } = useCollaborativeDoc({
  docId: documentId,
  requestSource: TAB_ID,
  user: { name: "Steve", email: "steve@example.com", color: "#60a5fa" },
});
```

### 5. Add TipTap extensions

```typescript
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { Awareness } from "y-protocols/awareness";

// Create awareness for cursor sync
const awareness = new Awareness(ydoc);
awareness.setLocalStateField("user", { name, color });

const editor = useEditor({
  extensions: [
    StarterKit.configure({ history: false }), // Yjs handles undo
    Collaboration.configure({ document: ydoc }),
    CollaborationCaret.configure({
      provider: { awareness },
      user: { name, color },
    }),
  ],
  content: initialContent,
});
```

## Live cursors & presence {#live-cursors}

The `CollaborationCaret` extension renders colored cursor lines with user name labels for each connected user. The `useCollaborativeDoc` hook provides an `activeUsers` array that can be used to render a presence bar with user avatars.

User identity is derived from the session email. The framework provides `emailToColor()` and `emailToName()` helpers to generate consistent cursor colors and display names from email addresses.

## Comments {#comments}

Templates can add a comments system with threaded discussions on documents. The content template includes a full implementation with:

- `document_comments` SQL table (threads, replies, resolved status)
- CRUD API routes at `/api/comments`
- Comments sidebar with threaded view and reply UI
- Resolve/unresolve threads
- **Send to AI** button — sends the comment thread context to the agent chat via `sendToAgentChat()`
- Agent actions: `list-comments`, `add-comment`
- Notion comment sync: `sync-notion-comments` action for bidirectional pull/push

## Collab routes {#collab-routes}

All collab routes are auto-mounted under `/_agent-native/collab/` by the collab plugin:

| Route | Purpose |
|-------|---------|
| `GET /:docId/state` | Fetch full Y.Doc state (base64) |
| `POST /:docId/update` | Apply client Yjs update |
| `POST /:docId/text` | Apply full text replacement (diff-based) |
| `POST /:docId/search-replace` | Surgical find/replace in Y.XmlFragment |
| `POST /:docId/awareness` | Sync cursor/presence state |
| `GET /:docId/users` | List active users on a document |

## Agent edit action {#edit-document}

The `edit-document` action is the primary way agents make changes to documents in collaborative mode:

```bash
# Single edit
pnpm action edit-document --id doc123 --find "old text" --replace "new text"

# Batch edits
pnpm action edit-document --id doc123 --edits '[{"find":"old","replace":"new"}]'

# Delete text
pnpm action edit-document --id doc123 --find "delete me" --replace ""
```

When collab state exists for the document, the action calls the server's `search-replace` endpoint via HTTP (not the collab module directly, since actions run in a separate process). The server walks the Y.XmlFragment tree, finds the text in Y.XmlText nodes, and applies minimal delete/insert operations. The resulting Yjs update is broadcast to all connected clients via the poll system.

## Common pitfalls {#pitfalls}

- **TipTap version mismatch** — All `@tiptap/*` packages must be the same version. The Collaboration extension requires `editor.utils` which was added in v3.22.2. Add `@tiptap/core` as an explicit dependency.
- **Empty editor on first load** — The Collaboration extension does NOT auto-seed from the `content` prop. Seed manually with `editor.commands.setContent()` when the Y.XmlFragment is empty.
- **Data loss from empty saves** — Guard against saving empty content in the `onUpdate` handler when the editor is in collab mode but hasn't been seeded yet.
- **Vite dep optimization** — Always add Yjs-related packages to `optimizeDeps.include` to prevent Vite from re-bundling TipTap in incompatible ways.
- **Separate process for actions** — Actions run via `pnpm action` in a new Node.js process. Use the server's HTTP endpoints (not the collab module directly) so updates reach the poll system.
