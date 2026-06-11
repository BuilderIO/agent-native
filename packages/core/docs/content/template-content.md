---
title: "Content"
description: "A Notion-style document editor with an AI agent that can read, write, reorganize, and publish your pages — all in plain English."
---

# Content

A Notion-style document workspace where the agent can read, write, reorganize, and publish pages for you. Open a doc, ask "rewrite this paragraph to be more concise" or "create a page called Q4 Planning with sub-pages for Goals, Metrics, and Risks" — same result whether you do it yourself or ask.

<!-- screenshot:
  app: content
  view: /<doc-id>
  shows: Workspace with sidebar tree (Q3 Roadmap favorited and expanded with Goals/Metrics/Risks, Engineering Wiki with On-call playbook + Architecture overview + Deployment guide, Personal section with Reading list and Ideas, Weekly sync — May 1) and the Q3 Roadmap document open in the editor with the agent sidebar
  account: screenshot-account (page tree authored on this account; the doc body should NOT begin with the page title — the page chrome already renders it)
  capture: 1400x800 viewport, cropped 90px from bottom (final 1400x710)
-->

![Content workspace with the page tree, an open document, and the agent sidebar](/screenshots/content.png)

When you open the app, you'll see a sidebar tree of pages on the left, the editor in the middle, and the agent in the sidebar on the right. The agent always knows which page you're viewing and what text you have selected.

## What you can do with it

- **Write rich text** with headings, lists, tables, code blocks, images, and links. Slash commands (`/`) insert blocks; selecting text pops up a formatting toolbar.
- **Organize pages in a tree** — nest infinitely, drag to reorder, favorite pages you use often.
- **Search across everything** with full-text search across titles and content.
- **Sync with local Markdown/MDX files.** Use the `/local-files` view to export
  your workspace to files, edit them in your own tools, preview changes, and
  import them back.
- **Sync with Notion.** Link a local doc to a Notion page and pull or push content in either direction. Comments sync both ways too.
- **Collaborate in real time.** Multiple people (and the agent) can edit the same doc at the same time.
- **Share docs** with teammates or make them public — private by default, with viewer / editor / admin roles.
- **Ask the agent for anything**: "Rewrite this paragraph." "Add a TL;DR at the top." "Find all my meeting notes from last week." "Make this tone more formal."

## Getting started

Live demo: [content.agent-native.com](https://content.agent-native.com).

When you open the app, click **+ New page** in the sidebar, give it a title, and start writing. To use the agent, type in the sidebar:

- "Create a page called Onboarding and add three sub-pages under it."
- "Rewrite this paragraph to be more concise." (with a page open)
- "Add a section about pricing with three bullet points."
- "Summarize this doc into a TL;DR at the top."
- "Pull the latest from Notion." (after linking a Notion page)

Select text and hit Cmd+I to focus the agent with that selection pre-loaded — "make this punchier" then operates on exactly what you highlighted.

## Local Markdown files {#local-files}

Content can round-trip documents through local files without cloning or running
the Content app locally. Open `/local-files`, choose a folder in your browser or
Agent Native Desktop, and export the current document tree as Markdown/MDX under
`content/`.

Each exported file contains frontmatter for document metadata (`id`, `title`,
`parentId`, `position`, favorite/search/visibility flags, and `updatedAt`) plus
the document body as Markdown. You can edit those files in your normal editor,
then return to `/local-files` to preview and import changes back into Content.

This workflow is useful when you want content in source control, want to batch
edit docs with local tools, or want a no-clone path for teams that prefer files
as the review surface. The hosted app remains the source of truth for sharing,
comments, permissions, and live collaboration; the local folder is an explicit
sync surface.

## Why it's interesting

Three things make Content a good showcase of the framework:

1. **Agent and editor share one Yjs document.** The same CRDT that prevents conflicts between two simultaneous human typists is what the agent writes through via `edit-document`. There is no separate AI path — the diff appears live in every open browser tab.
2. **Notion sync as a two-way bridge.** Rather than replacing Notion, the template treats it as a peer: pull, push, bidirectional comment sync, conflict detection, and content-hash deduplication are all first-class. It demonstrates how agent-native apps can round-trip with external systems without losing their SQL-backed canonical form.
3. **Inline databases alongside prose.** The `content_databases` / `content_database_items` / `document_property_definitions` stack shows how structured tabular data can live inside an agent-native document without needing a separate app or a custom Airtable integration.

## For developers

The rest of this doc is for anyone forking the Content template or extending it.

### Quick start

Scaffold a new workspace with the Content template:

```bash
npx @agent-native/core@latest create my-workspace --standalone --template content
cd my-workspace
pnpm install
pnpm dev
```

Open `http://localhost:8083` and create your first page. The agent panel is on the right — try asking it to "create a page called Onboarding and add three sub-pages under it".

### Key features (technical) {#key-features}

### Hierarchical pages

Documents nest infinitely via a `parent_id` column. The sidebar renders a draggable tree; children move with their parents and ordering uses an integer `position` field. See `app/components/sidebar/DocumentSidebar.tsx` and `app/components/sidebar/DocumentTreeItem.tsx`.

### Rich-text editor

The editor is built on Tiptap with a custom extension set. It supports headings, lists, tables, code blocks with syntax highlighting, images, and links. Implementation lives in `app/components/editor/DocumentEditor.tsx` and `app/components/editor/VisualEditor.tsx`, with custom nodes under `app/components/editor/extensions/` (`CodeBlockNode.tsx`, `ImageNode.ts`, `DragHandle.tsx`, `NotionExtensions.tsx`).

Interactive surfaces include:

- `BubbleToolbar.tsx` — formatting toolbar that appears over a selection
- `SlashCommandMenu.tsx` — slash-command inserter for blocks
- `LinkHoverPreview.tsx` — hover previews for inline links
- `TableHoverControls.tsx` — add/remove table rows and columns
- `EmojiPicker.tsx` — emoji picker for page icons

### Collaborative editing

Content is edited through Yjs CRDT so multiple users and the agent can type into the same document at once without clobbering each other. The agent's `edit-document` action writes through the same pipeline as a human keystroke, so changes appear live in every open editor. See [Real-time collaboration](/docs/real-time-collaboration) for the sync model.

### Search

Full-text search across titles and markdown content, powered by `actions/search-documents.ts`. The sidebar exposes a search box; the agent uses the same action via `pnpm action search-documents --query "..."`.

### Favorites and icons

Each document can be favorited (`is_favorite`) and given an emoji `icon`. The index route auto-opens your first favorite on load — see `app/routes/_app._index.tsx`.

### Notion sync

Documents can be linked to a Notion page and synced in either direction:

- `connect-notion-status` — check whether a Notion integration is connected
- `link-notion-page` — link a local doc to a Notion page
- `pull-notion-page` — overwrite local content from Notion
- `push-notion-page` — overwrite Notion content from local
- `list-notion-links` — list all linked documents
- `sync-notion-comments` — bidirectionally sync comment threads

Sync state is tracked in the `document_sync_links` table (last synced time, conflict flag, last error). Markdown-to-Notion block conversion lives in `shared/notion-markdown.ts`. Conflict and status UI is in `app/components/editor/NotionConflictBanner.tsx` and `NotionSyncBar.tsx`. See the `notion-integration` skill for the full flow.

### Local file sync

The protected `/local-files` route uses the browser File System Access API (or
the same Chromium capability inside Agent Native Desktop) to read and write
Markdown/MDX files from a user-chosen folder. It calls:

- `export-content-source` — reads the accessible document tree and returns a
  deterministic `content/` file bundle.
- `import-content-source` — validates files, creates new private documents,
  updates documents where the caller has editor access, preserves version
  history, and rejects invalid parent cycles.

The source format lives in `shared/content-source.ts`. Keep that file as the
single contract for filenames, frontmatter, parsing, and serialization.

### Comments

Threaded comments on documents with quoted-text anchors, replies, and resolve state. Backed by the `document_comments` table and `app/components/editor/CommentsSidebar.tsx`. Actions: `list-comments`, `add-comment`. Notion comments can sync both ways via `sync-notion-comments`.

### Version history

Every significant update snapshots a row in the `document_versions` table. The UI surfaces these in `app/components/editor/VersionHistoryPanel.tsx`.

### Sharing and visibility

Documents are private by default. You can change visibility to `org` or `public`, or grant per-user and per-org roles (`viewer`, `editor`, `admin`). The framework's auto-mounted sharing actions work out of the box:

- `share-resource --resourceType document --resourceId <id> --principalType user --principalId <email> --role editor`
- `unshare-resource` / `list-resource-shares` / `set-resource-visibility`

See the `sharing` skill.

### Teams

A dedicated team page at `/team` (see `app/routes/_app.team.tsx`) uses the framework's `TeamPage` component for creating orgs and managing members.

### Working with the agent

Because the agent sees your current screen, most prompts don't need you to reference a document explicitly. When you have a page open, "this" means that page.

For small edits, the agent uses `edit-document --find ... --replace ...` so only the changed text flows through Yjs — you'll see the diff applied in place rather than the whole page re-render. For bigger rewrites it uses `update-document --content ...`.

If you select text and press Cmd+I (or focus the agent panel), the selection travels with your next message as context, so "make this punchier" operates on exactly what you highlighted.

### Databases and properties

Documents can host inline databases — Notion-style tables where each row is itself a document. The agent can create databases, add items, configure column definitions, and set property values through actions: `create-content-database`, `add-database-item`, `set-document-property`. Property definitions (type, visibility, options, position) live in `document_property_definitions`; per-row values live in `document_property_values`.

### Additional actions

Beyond the CRUD surface in the data model, the template ships `export-document` for converting a page to Markdown or HTML, `transcribe-media` for attaching a transcript to a page, and `restore-document-version` for rolling back to an earlier snapshot.

### Data model

Nine tables, all defined in `server/db/schema.ts`:

- **`documents`** — the page tree. Columns: `id`, `parent_id`, `title`, `content` (markdown), `icon`, `position`, `is_favorite`, `visibility`, `owner_email`, `org_id`, `created_at`, `updated_at`.
- **`document_versions`** — full snapshots of title and content for version history. Roll back with `restore-document-version`.
- **`document_comments`** — threaded comments with `thread_id`, `parent_id`, `quoted_text`, `resolved`, and an optional `notion_comment_id` for bidirectional Notion sync.
- **`document_sync_links`** — one row per Notion-linked document tracking remote page ID, last sync times, conflict state, content hash, and errors.
- **`document_property_definitions`** — column definitions for inline databases: name, type, visibility, options, and position.
- **`content_databases`** — inline database objects attached to a `document_id` with a title and view config JSON.
- **`content_database_items`** — rows in an inline database, each linking a `database_id` to a `document_id`.
- **`document_property_values`** — per-document property values (`property_id` → `value_json`).
- **`document_shares`** — per-user and per-org grants created via `createSharesTable`.

Content is stored as markdown. The editor converts to and from the Tiptap JSON model in memory; the SQL row is always markdown so actions, search, and Notion sync can operate on a single canonical format.

All ownable tables include `owner_email` and `org_id` via `ownableColumns()`, so every row is scoped to the signed-in user (and optionally their active organization) from the moment it's created.

### Customizing it

The four places to look when changing behavior:

- **`actions/`** — every operation the agent or UI can perform. Add a new file like `actions/publish-to-wordpress.ts` using `defineAction` and both sides get it for free. Key existing actions: `create-document.ts`, `edit-document.ts`, `update-document.ts`, `delete-document.ts`, `list-documents.ts`, `search-documents.ts`, `get-document.ts`, `pull-notion-page.ts`, `push-notion-page.ts`, `add-comment.ts`, `view-screen.ts`, `navigate.ts`.
- **`app/routes/`** — the page surface. `_app.tsx` is the pathless layout that keeps the sidebar and agent panel mounted; `_app._index.tsx` is the landing view; `_app.page.$id.tsx` is the editor route; `_app.team.tsx` is the team settings page.
- **`app/components/editor/`** — the Tiptap editor. Add a new node type under `extensions/` and register it in `DocumentEditor.tsx`. The bubble toolbar, slash menu, and hover previews are all component files you can edit.
- **`.agents/skills/`** — guidance the agent reads before acting. If you add a new capability (say, a CMS publishing pipeline), drop a `SKILL.md` in a new skill folder so the agent uses it correctly. Existing skills: `document-editing`, `notion-integration`, `real-time-sync`, `delegate-to-agent`, `storing-data`, `self-modifying-code`, `security`, `frontend-design`, `create-skill`, `capture-learnings`.
- **`AGENTS.md`** — the top-level agent guide with the action cheatsheet and common-tasks table. Update it whenever you add a major feature so the agent discovers it without exploring.
- **`server/db/schema.ts`** — data model. Add a column or table here. The Content template has no `db:push` script; it relies on strictly additive migrations that run on startup. Edit `server/db/schema.ts`, write a matching additive migration, and the change applies the next time the app boots — schema updates must never drop, rename, or destructively alter existing tables or columns (see [Database](/docs/database#migrations) for guidelines).
- **`shared/notion-markdown.ts`** — markdown-to-Notion-blocks conversion. Extend this if you add new block types that need to round-trip through Notion.

The agent can make all of these changes itself — ask it to "add a tags column to documents and expose it in the sidebar" and it will update the schema, migrate, wire the UI, and write the action.
