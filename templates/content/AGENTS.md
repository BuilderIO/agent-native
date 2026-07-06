# Documents — Agent Guide

Documents is an agent-native editor for docs, comments, media blocks, sharing,
and Notion-connected content. The agent edits documents through actions and
application state shared with the UI.

Detailed document editing, Notion, storage, and UI rules live in
`.agents/skills/`.

## Core Rules

- Never hardcode API keys, tokens, webhook URLs, signing secrets, private Builder/internal data, customer data, or credential-looking literals. Use secrets/OAuth/runtime configuration and obvious placeholders in examples.
- Use actions for documents, blocks, comments, media, sharing, navigation, and
  Notion integration. Do not mutate document rows directly unless a skill says to
  and access checks are preserved.
- Notion workspace access is per-user OAuth only. Never read `NOTION_API_KEY`
  from `process.env`, never save a user-entered Notion token through
  `/_agent-native/env-vars`, and require editor access for routes that pull or
  push Notion content.
- Treat Notion workflow actions as shortcuts, not capability limits. When the
  exact Notion endpoint/filter/pagination/API version matters, use
  `provider-api-catalog`, `provider-api-docs`, and `provider-api-request`
  against the real Notion API. The provider API resolves auth from the user's
  Notion OAuth connection, never from `NOTION_API_KEY`. For large scans, stage
  results with `stageAs` and analyze them with `query-staged-dataset`.
- Preserve user-authored content. Prefer targeted edits over wholesale rewrites
  unless requested.
- For cross-app or Slack artifact requests, create/update the document artifact
  through the app action path so it remains visible and shareable.
- Use `view-screen` when the active document, selected block, comment, or Notion
  context is unclear.
- Use framework sharing actions for document visibility and grants.
- Keep public/exported content server-renderable where relevant.

## Application State

- `navigation` exposes document, selected block, comment, media, and Notion view
  context.
- `navigate` moves the UI to documents, comments, media, and settings surfaces.
- Use actions for full document content and comment context.

## Skills

Read the relevant skill before deeper work:

- `document-editing` for structured document updates.
- `notion-integration` for connected Notion workflows.
- `storing-data`, `real-time-sync`, `security`, `actions`, `frontend-design`,
  and `shadcn-ui` for framework work.

## Navigation State

```json
{
  "view": "editor",
  "documentId": "abc123"
}
```

Views: `list` (document tree), `editor` (viewing/editing a document).

**Do NOT write to `navigation`** — it is overwritten by the UI. Use `navigate` to control the UI.

## Actions

**Always use `pnpm action <name>` for all operations.** Never use `curl`, raw HTTP requests, or `db-exec` with raw SQL for document operations.

### Cross-App A2A / Slack Artifact Rule

When a request arrives from Slack, Dispatch, or another app via A2A, the caller cannot see Content's local UI or navigation state. After creating or updating a document, reply with the concrete document ID and URL/path only after the action succeeds. Use `/page/<id>` for private app documents (or `/p/<id>` only for documents you explicitly made public). Never say a document is ready without including the exact ID or URL/path returned by the action.

**Running actions from the frame:** The terminal cwd is the framework root. Always `cd` to this template's root before running any action:

```bash
cd templates/content && pnpm action <name> [args]
```

`.env` is loaded automatically — **never manually set `DATABASE_URL` or other env vars**.

### Context & Navigation

| Action         | Args                              | Purpose                    |
| -------------- | --------------------------------- | -------------------------- |
| `view-screen`  |                                   | See what the user sees now |
| `navigate`     | `--path <path>` or `--documentId` | Navigate the UI            |
| `refresh-list` |                                   | Trigger UI refresh         |

### Document Operations

| Action                                      | Args                                                                                                                                                           | Purpose                                                                                                                                 |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `list-documents`                            | `[--format json]`                                                                                                                                              | List document metadata/tree; no full bodies                                                                                             |
| `export-content-source`                     | `[--format json]`                                                                                                                                              | Export editable docs as `content/*.mdx` source files                                                                                    |
| `import-content-source`                     | `--files <json> [--dryRun true\|false]`                                                                                                                        | Import `.md`/`.mdx` source files into editable docs                                                                                     |
| `list-builder-docs`                         | `[--model docs-content\|blog-article] [--limit <n>]`                                                                                                           | List Builder docs/blog entries available for `.builder.mdx` pull                                                                        |
| `pull-builder-doc`                          | `--model <model> --entryId <builder-entry-id> [--dryRun true\|false]`                                                                                          | Pull one Builder entry into Content and return `.builder.mdx` plus `content/builder/.raw` sidecar files                                 |
| `check-builder-doc`                         | `--files <json> [--path <file.builder.mdx>]` or `--documentId <id>`                                                                                            | Validate Builder MDX round-trip, sidecar hashes, and remote conflict status before push                                                 |
| `push-builder-doc`                          | `--files <json> [--path <file.builder.mdx>] [--dryRun true\|false]`                                                                                            | Guarded Builder autosave PATCH for the safe Builder test model; never publishes                                                         |
| `navigate`                                  | `--path <path>` or `--documentId <id>` or `--databaseId <id>`                                                                                                  | Open a route, document page, or database page in the UI                                                                                 |
| `search-documents`                          | `--query <text> [--format json]`                                                                                                                               | Search by title/content and return snippets                                                                                             |
| `get-document`                              | `--id <id> [--format json]`                                                                                                                                    | Get a single document with content                                                                                                      |
| `pull-document`                             | `--id <id> [--format markdown\|text]`                                                                                                                          | Collab-aware "ingest the final" read                                                                                                    |
| `create-document`                           | `--title <text> [--content] [--parentId] [--icon]`                                                                                                             | Create a new document                                                                                                                   |
| `edit-document`                             | `--id <id> --find <text> --replace <text>`                                                                                                                     | Surgical text edit (preferred for modifications)                                                                                        |
| `edit-document`                             | `--id <id> --edits <json>`                                                                                                                                     | Batch surgical text edits                                                                                                               |
| `update-document`                           | `--id <id> [--title] [--content] [--icon]`                                                                                                                     | Full rewrite of document fields                                                                                                         |
| `share-local-file-document`                 | `--id <local-file-document-id>`                                                                                                                                | Create or refresh a DB-backed shareable copy of a local file document                                                                   |
| `list-local-component-files`                |                                                                                                                                                                | List registered local MDX component source files                                                                                        |
| `write-local-component-file`                | `--workspaceId <id> --path <relative-component-path> --content <source>`                                                                                       | Create or update a file in a registered local `components/` folder                                                                      |
| `create-content-database`                   | `[--documentId <id>] [--parentId <id>] [--title <text>]`                                                                                                       | Create a database page or convert an existing page into a database                                                                      |
| `get-content-database`                      | `--databaseId <id>` or `--documentId <id>`                                                                                                                     | Get a database table with property schema and item pages                                                                                |
| `get-content-database-source`               | `--databaseId <id>` or `--documentId <id>`                                                                                                                     | Inspect local/no-source or source-backed status, mappings, row identity, freshness, and change sets                                     |
| `attach-content-database-source`            | `--databaseId <id>` or `--documentId <id> [--sourceType mock\|builder-cms] [--sourceName] [--sourceTable] [--relationshipMode items\|details] [--join <json>]` | Attach a source binding; use `items` to add more rows and `details` to match a source onto existing rows                                |
| `change-content-database-source-role`       | `--databaseId <id>` or `--documentId <id> --sourceId <id> --relationshipMode items\|details [--join <json>]`                                                   | Change an attached source between adding rows and adding matched detail columns without removing the source                             |
| `refresh-content-database-source`           | `--databaseId <id>` or `--documentId <id>`                                                                                                                     | Refresh the read-only source status envelope; Builder CMS reads live entries only when configured                                       |
| `process-builder-body-hydration`            | `--sourceId <id> [--documentId <id>] [--limit <n>]`                                                                                                            | Hydrate queued Builder article bodies into readable Content markdown with preserved source-component markers                            |
| `set-content-database-source-write-mode`    | `--databaseId <id>` or `--documentId <id> --liveWritesEnabled true\|false [--allowedWriteModes <json>]`                                                        | Enable/disable per-source Builder live writes; enabling is allowed only for `agent-native-blog-article-test` with explicit modes        |
| `stage-builder-revision`                    | `--databaseId <id>` or `--documentId <id>`                                                                                                                     | Stage pending local Builder CMS changes as a local-only save-revision record; never calls Builder                                       |
| `review-content-database-source-change-set` | `--databaseId <id>` or `--documentId <id> --changeSetId <id> --decision approve\|reject [--note]`                                                              | Approve or reject a local source change-set review record without provider writes                                                       |
| `prepare-builder-source-execution`          | `--databaseId <id>` or `--documentId <id> --changeSetId <id> [--pushModeConfirmation autosave\|draft\|publish]`                                                | Prepare a dry-run Builder execution gate for approved field/body changes with request semantics/idempotency key; never calls Builder    |
| `validate-builder-source-execution`         | `--databaseId <id>` or `--documentId <id> --changeSetId <id> [--idempotencyKey <key>]`                                                                         | Validate/replay a prepared Builder execution gate locally as a dry run; never calls Builder                                             |
| `execute-builder-source-execution`          | `--databaseId <id>` or `--documentId <id> --changeSetId <id> [--idempotencyKey <key>] [--pushModeConfirmation autosave\|draft\|publish]`                       | Execute a guarded live Builder write only when approved, validated, enabled, idempotent, and targeting `agent-native-blog-article-test` |
| `add-database-item`                         | `--databaseId <id> [--title <text>] [--propertyValues <json>]`                                                                                                 | Add a page row to a database, optionally seeding property values                                                                        |
| `duplicate-database-item`                   | `--itemId <id>` or `--documentId <id> [--title <text>]`                                                                                                        | Duplicate exactly one database row page and its stored property values; for two or more rows, use `duplicate-database-items` once       |
| `duplicate-database-items`                  | `--databaseId <id>` or `--documentId <databaseDocumentId> --itemIds <json-array>` or `--documentIds <json-array>`                                              | Preferred multi-row duplicate action; duplicate multiple database row pages atomically and return ordered duplicate item/document IDs   |
| `delete-database-items`                     | `--databaseId <id>` or `--documentId <databaseDocumentId> --itemIds <json-array>` or `--documentIds <json-array>`                                              | Preferred multi-row delete action; delete multiple database row pages atomically while preserving `delete-document` admin semantics     |
| `move-database-item`                        | `--itemId <id>` or `--documentId <id> --position <number>`                                                                                                     | Move a database row page to a new zero-based table position                                                                             |
| `update-content-database-view`              | `--databaseId <id> --viewConfig <json>`                                                                                                                        | Persist database views, sorts, filters, hidden properties, and view settings                                                            |
| `list-document-properties`                  | `--documentId <id> [--format json]`                                                                                                                            | List Notion-style property definitions and values for a document                                                                        |
| `configure-document-property`               | `--documentId <id> [--id <propertyId>] --name <name> --type <type> [--visibility always_show\|hide_when_empty\|always_hide]`                                   | Create or update a property definition                                                                                                  |
| `duplicate-document-property`               | `--documentId <id> --propertyId <propertyId>`                                                                                                                  | Duplicate a property definition and its stored values                                                                                   |
| `delete-document-property`                  | `--documentId <id> --propertyId <propertyId>`                                                                                                                  | Delete a property definition and its stored values                                                                                      |
| `set-document-property`                     | `--documentId <id> --propertyId <propertyId> --value <json>`                                                                                                   | Set a document property value (for a `blocks` field, the value is its markdown content)                                                 |
| `reorder-document-property`                 | `--documentId <id> --propertyId <propertyId> --targetPropertyId <id> [--position before\|after]`                                                               | Reorder a property definition within its database (used to reorder Blocks fields on the page)                                           |
| `set-document-discoverability`              | `--id <id> --hideFromSearch true\|false [--includeChildren true\|false]`                                                                                       | Hide/show an org-accessible document in Organization/search while keeping link access                                                   |
| `move-document`                             | `--id <id> [--parentId] [--position]`                                                                                                                          | Move or reorder a document in the page tree                                                                                             |
| `delete-document`                           | `--id <id>`                                                                                                                                                    | Delete with recursive children                                                                                                          |

Database views follow Notion-style tab labels. When creating or duplicating
views in `viewConfig`, use unique default names (`Table 2`, `SEO copy 2`, etc.)
instead of appending several tabs with the same label.

**`pull-document` is the collab-aware "ingest the final" read** — prefer it over
`get-document` for external ingest (another app, an external coding agent over
MCP/A2A, an A2A peer). `get-document` returns whatever is in the
`documents.content` SQL column, which can lag behind a live editing session: the
open editor holds the authoritative Y.Doc in memory and only debounces it back
to SQL. `pull-document` closes that gap with a flush handshake — if a live Yjs
collab session exists for the document it writes a one-shot `flush-request-<id>`
application-state key (scoped to the browser session, just like `navigate`); the
open editor sees that key, serializes its current document to markdown through
its own existing serializer, calls `update-document`, and deletes the key;
`pull-document` waits for the key to clear and then returns the now-fresh row.
When no editor is open the SQL column is authoritative and the handshake is
skipped. It is GET + read-only + public-agent exposed (`requiresAuth: true`),
returns `{ id, title, content, format, deepLink }`, and surfaces an
"Open document" deep link for external agents. Use `--format text` for a
plain-text strip of the markdown.

### Local Source Files

Content has two file workflows:

- **Database mode local folders:** the `/local-files` view links one or more
  browser or Agent Native Desktop folders to SQL-backed documents. The UI uses
  folder rows: **Pull** reads local `.md`/`.mdx` files through
  `import-content-source`, **Check** runs the same import as `--dryRun true`,
  and **Push** uses `export-content-source` to write Content documents back to
  the chosen folder. Files with known `id` values update existing docs only
  when the caller has editor access, and files without ids create new private
  docs for the current user. Imported rows keep `source.mode: "local-files"`
  and `source.path`, so `list-documents`/`get-document` can distinguish them
  from ordinary private pages and the sidebar can show them under Local files.
  With one linked folder, imported paths stay flat (`content/page.mdx`); with
  multiple linked folders, paths are prefixed by folder name so Local files can
  group them by folder. Once a source folder is linked, the selected
  `.md`/`.mdx` file is authoritative: opening the page reads the file, editor
  saves write the file first, and SQL is updated afterward as
  cache/history/search glue. Use `--dryRun true` before a large import when the
  source folder may contain unexpected files.
- **Local File Mode editing:** when the app runs with `AGENT_NATIVE_MODE=local-files`
  or an `agent-native.json` whose app config enables local files, the standard
  Content editor reads and writes configured repo files directly. The left
  sidebar is populated from local roots such as `docs/`, `blog/`, `content/`,
  and `resources/`; selecting a file opens `/page/<local-file-id>` and
  `update-document` writes the selected `.md`/`.mdx` file. The document id is
  derived from the file path, and unknown frontmatter is preserved when title,
  content, icon, or favorite state changes.
  Repos can opt into `profile: "docs/no-bookkeeping"` to keep docs edits from
  adding absent `updatedAt`, `icon`, or `isFavorite` frontmatter. Content-only
  edits under that profile preserve existing frontmatter but do not create new
  bookkeeping keys; explicit title/icon/favorite edits still persist.
- **Local MDX components:** local file workspaces can expose React components
  from the configured `components` folder. Export PascalCase components such as
  `ImpactCounter` from `.tsx` files, then use `<ImpactCounter />` in MDX or pick
  it from the editor slash menu under Local components. Simple string props are
  previewed. Components can export editable input metadata such as
  `ImpactCounterInputs` with `string`, `textarea`, `number`, `boolean`, and
  `select` fields; selecting the component in the editor shows a corner edit
  button that rewrites the MDX props. JSX expression props are preserved in
  source but shown as an unsupported preview.
- **Reusable MDX references:** local-file MDX can embed another local document
  with `<ContentReference sourcePath="./shared/example.mdx" />`. The editor
  resolves `sourcePath` relative to the current file, previews the referenced
  MDX read-only in place, and preserves the original tag in source. Use this for
  reusable docs fragments instead of copy/pasting shared content.
- **Builder Symbols:** Builder MDX pulls preserve Symbol blocks as
  `<BuilderSymbol ... />`. When Builder returns enriched symbol content, the
  pull also writes a referenced `.builder.mdx` file under
  `content/builder/symbols/` and sets the Symbol block's `source` attribute.
  Edit reusable symbol content in that emitted source file; do not retarget
  `entry`, `model`, or `source` in the parent MDX unless a dedicated Builder
  retargeting workflow is added.
- **Builder source components:** Builder CMS database body hydration renders
  unsupported provider-native body blocks as `<SourceComponent ... />` markers.
  These markers include `mappingStatus` and `sourceEditState`: `mapped` /
  `safe-to-edit` content has an explicit Markdown/NFM mapper, `preserved` /
  `needs-review` content keeps a known Builder/source component intact for
  review, and `unknown` / `preserved-only` content is an unmapped provider block
  that must round-trip as-is. Treat source-component markers as read-only
  preservation anchors, not editable local blocks. Agents may edit surrounding
  prose, but must not delete, duplicate, move, or rewrite `rawRef`, `rawHash`,
  mapping metadata, or marker ids unless a dedicated provider conversion
  workflow exists. Guarded Builder write-back refuses missing, tampered, or
  structurally moved markers so source-native components are not lost.
  Readable bodies hydrated before source-component mapping may need a fresh
  Builder body hydration pass before guarded push, because newly preserved
  markers are intentionally treated as structure changes.
- **Picked folders and components:** browser-picked folders can be the
  source of truth for `.md`/`.mdx` files, but the browser does not expose an
  absolute path that Vite can compile. Component previews from a picked
  `components/` folder require Agent Native Desktop or a local Content dev
  server. Desktop-selected folders register their workspace path with the local
  dev server so Vite can import and hot reload `components/*.tsx`.
- **Agent component edits:** use `list-local-component-files` to find the
  registered workspace id, then `write-local-component-file` to add or edit
  `.tsx`, `.jsx`, `.ts`, or `.js` files under that workspace's `components/`
  folder. The Vite component registry reloads after file additions/removals;
  edits to already-loaded files hot reload through Vite.

Minimal `agent-native.json`:

```json
{
  "version": 1,
  "apps": {
    "content": {
      "mode": "local-files",
      "profile": "docs/no-bookkeeping",
      "roots": [
        {
          "name": "Docs",
          "path": "docs",
          "profile": "docs/no-bookkeeping",
          "extensions": [".md", ".mdx"]
        },
        { "name": "Blog", "path": "blog", "extensions": [".md", ".mdx"] },
        {
          "name": "Resources",
          "path": "resources",
          "extensions": [".md", ".mdx"]
        }
      ],
      "components": "components"
    }
  }
}
```

Launch Content directly against a local folder or file with:

```bash
agent-native content local-files docs --profile docs/no-bookkeeping
agent-native content local-files docs/guide.mdx --profile docs/no-bookkeeping
```

In Local File Mode, use the normal document actions (`list-documents`,
`get-document`, `create-document`, `update-document`, `delete-document`) instead
of raw filesystem writes when operating through the app. To share a local file,
call `share-local-file-document --id <local-file-document-id>` first; it creates
or refreshes a database-backed copy and returns the shareable document id.
Provider sync such as Builder.io pull/push should remain a Content-specific
explicit sync action.

### Notion Integration

| Action                  | Args                                    | Purpose                                   |
| ----------------------- | --------------------------------------- | ----------------------------------------- |
| `connect-notion-status` |                                         | Check Notion connection                   |
| `link-notion-page`      | `--documentId <id> --notionPageId <id>` | Link doc to Notion page                   |
| `list-notion-links`     |                                         | List linked documents                     |
| `pull-notion-page`      | `--documentId <id>`                     | Pull content from Notion                  |
| `push-notion-page`      | `--documentId <id>`                     | Push content to Notion                    |
| `sync-notion-comments`  | `--documentId <id>`                     | Sync comments with Notion (bidirectional) |

Use `provider-api-catalog`, `provider-api-docs`, and `provider-api-request`
for Notion endpoints, filters, pagination modes, payload shapes, or API
versions that these workflow actions do not model. Use `stageAs` plus
`query-staged-dataset` for large Notion searches or database queries.

### Comments

Comments are Notion/Google-Docs-style **inline comments**. Selecting text and
commenting leaves the passage **highlighted inline** in the editor via a
ProseMirror decoration overlay — nothing is written into the markdown body, so
the NFM/Notion round-trip is unchanged. Each thread stores the quoted text plus
surrounding context (`anchorPrefix`/`anchorSuffix`) and an approximate
`anchorStartOffset`, so the highlight follows the text as the document is
edited, disambiguates repeated text, and degrades gracefully (the thread stays
in the sidebar) when its text is deleted. Resolving a thread clears its
highlight and moves it to a collapsible **"Resolved (n)"** sidebar section where
it can be **reopened** with `update-comment --resolved false`. Comments support
**@mentions** of org members, stored as a `mentions` array of `{email, name}`.

| Action           | Args                                                                                                                                                                     | Purpose                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `list-comments`  | `--documentId <id>`                                                                                                                                                      | List threads with anchor fields + parsed mentions  |
| `add-comment`    | `--documentId <id> --content <text> [--threadId] [--parentId] [--quotedText] [--anchorPrefix] [--anchorSuffix] [--anchorStartOffset] [--authorName] [--mentions <json>]` | Add a comment or reply, optionally anchored inline |
| `update-comment` | `--id <id> [--content <text>] [--resolved true\|false]`                                                                                                                  | Edit a comment, or resolve/reopen its thread       |
| `delete-comment` | `--id <id>`                                                                                                                                                              | Delete a comment                                   |

`add-comment` anchors a thread inline when passed `--quotedText` plus the
surrounding `--anchorPrefix`/`--anchorSuffix` and `--anchorStartOffset`.
`--mentions` is a JSON array of `{email, name}`, e.g.
`'[{"email":"a@x.com","name":"A"}]'`. `--authorName` sets the display name and
defaults to a name derived from the author's email. `--resolved true` resolves a
whole thread; `--resolved false` reopens it.

### Versions

| Action                     | Args                                      | Purpose                            |
| -------------------------- | ----------------------------------------- | ---------------------------------- |
| `list-document-versions`   | `--documentId <id>`                       | List saved versions for a document |
| `restore-document-version` | `--documentId <id> --versionId <version>` | Restore a saved document version   |

### Image Blocks

Documents support image blocks as markdown images: `![alt text](https://...)`.
The UI uploads local image files through the framework
`/_agent-native/file-upload` endpoint, with Builder.io as the recommended
storage path. If image upload fails because storage is not configured, tell the
user to connect Builder.io in Settings -> File uploads. Agents can add images
that already have a hosted URL by using `edit-document` or `update-document` to
insert markdown image syntax. Do not embed base64 image data in document
content.

### Sharing

Documents are **private by default** — only the creator can see them. To grant access to others, change the visibility or add explicit share grants. These actions are auto-mounted framework-wide:

| Action                    | Args                                                                                                                                                                            | Purpose                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `share-resource`          | `--resourceType document --resourceId <id> --principalType user\|org --principalId <email-or-orgId> --role viewer\|editor\|admin --notify true\|false --resourceUrl /page/<id>` | Grant a user or org access to a document |
| `unshare-resource`        | `--resourceType document --resourceId <id> --principalType user\|org --principalId <email-or-orgId>`                                                                            | Revoke a share grant                     |
| `list-resource-shares`    | `--resourceType document --resourceId <id>`                                                                                                                                     | Show current visibility + all grants     |
| `set-resource-visibility` | `--resourceType document --resourceId <id> --visibility private\|org\|public`                                                                                                   | Change coarse visibility                 |

Read (`get-document`, `list-documents`, `search-documents`) admits rows the current user owns, has been shared on, or that match the resource's visibility. Write (`update-document`, `edit-document`) requires `editor` role or above; `delete-document` requires `admin` (owners always satisfy). See the `sharing` skill for the full model.

For Notion-style "workspace access but don't list it everywhere," set `visibility` to `org` and then run `set-document-discoverability --id <id> --hideFromSearch true`. Organization members can still open the document with the link, but it is omitted from their Organization sidebar and document search unless they own it or have an explicit share grant. Use `--includeChildren true` (default) when hiding a page with sub-pages so descendants do not leak into the org list.

Public documents are reachable at `/p/<id>` once visibility is `public`. Anyone with the link can read the page. The public page mounts a read-only agent chat with the document injected as context; public viewers must not create, edit, comment on, delete, or share documents through that chat.

## Common Tasks

| User request                   | What to do                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------ |
| "What am I looking at?"        | `view-screen`                                                                  |
| "Create a page about X"        | `create-document --title "X" --content "# X\n\n..."`                           |
| "Find my meeting notes"        | `search-documents --query "meeting notes"`                                     |
| "Update the title of this doc" | `view-screen` to get ID, `update-document --id ... --title "New"`              |
| "Fix a typo / small edit"      | `view-screen` to get ID, `edit-document --id ... --find "old" --replace "new"` |
| "Write new content here"       | `view-screen` to get ID, `update-document --id ... --content "..."`            |
| "Delete this page"             | `view-screen` to get ID, `delete-document --id ...`                            |
| "Add a sub-page"               | `view-screen` to get parent ID, `create-document --title ... --parentId ...`   |
| "Move this page"               | `view-screen` to get ID, `move-document --id ... --position ...`               |
| "Show me the document list"    | `list-documents`                                                               |
| "Open document X"              | `navigate --documentId=<id>`                                                   |
| "Go to the list view"          | `navigate --path=/`                                                            |
| "Pull from Notion"             | `view-screen` to get ID, `pull-notion-page --documentId ...`                   |
| "Push to Notion"               | `view-screen` to get ID, `push-notion-page --documentId ...`                   |

After any create, update, or delete operation, the scripts automatically trigger a UI refresh.

## Data Model

Documents are stored in the SQL `documents` table via Drizzle ORM:

| Column             | Type    | Description                                                                      |
| ------------------ | ------- | -------------------------------------------------------------------------------- |
| `id`               | text    | Primary key (12-char hex)                                                        |
| `owner_email`      | text    | Per-user owner; local mode starts as `local@localhost`                           |
| `org_id`           | text    | Owner's active org at creation time (nullable)                                   |
| `visibility`       | text    | `'private' \| 'org' \| 'public'` — coarse default (private)                      |
| `hide_from_search` | integer | `1` hides org-accessible docs from Organization/search while keeping link access |
| `parent_id`        | text    | Parent document ID (null for root)                                               |
| `title`            | text    | Document title                                                                   |
| `content`          | text    | Markdown content                                                                 |
| `icon`             | text    | Emoji icon                                                                       |
| `position`         | integer | Sort order within parent                                                         |
| `is_favorite`      | integer | Whether favorited (0 or 1)                                                       |
| `created_at`       | text    | ISO timestamp                                                                    |
| `updated_at`       | text    | ISO timestamp                                                                    |

A companion `document_shares` table holds per-user or per-org grants with a `role` (`viewer | editor | admin`). See the Sharing section above for the share actions.

Documents form a tree via `parent_id`. Content is stored as markdown.

Related tables (`document_versions`, `document_comments`, `document_sync_links`) also carry `owner_email` so a workspace can be upgraded cleanly from local mode to a real account without losing document history, comments, or Notion links.

Databases are document-backed page-level objects. A normal document has no
properties by default. A row in a database is also a document, linked through
`content_database_items`; when that row document opens, it shows the database's
properties. The database page itself renders as a table and owns the schema in
`document_property_definitions.database_id`. Database row documents and their
descendants stay contained by the database and are omitted from the ordinary
sidebar page tree; users open them from the database view or an explicit link.
When a row document is open, the editor shows a small parent-database breadcrumb
above the title so the user can return to the containing database without
relying on the sidebar. The `view-screen` document tree follows the same rule:
database row pages are omitted from the ordinary tree and counted separately as
contained database items. When a database row is open in the side preview,
navigation state includes `databasePreviewDocumentId`, and `view-screen` returns
that row as `databasePreview` with its content and properties. Database
navigation state also includes the active view type, search query, sort count,
the saved database view list, active sort/filter definitions, filter match
mode, saved column calculations, table cell wrapping state, table row density,
collapsed group IDs, calendar or timeline date property IDs/names, the visible
date range for calendar/timeline views, empty-group visibility state, visible
source summary when attached, and database row preview state. Source-aware
metadata lives alongside the database model in `content_database_sources`,
`content_database_source_fields`, `content_database_source_rows`, and
`content_database_source_change_sets`; those tables store binding status, field
mappings, source-qualified row identity/provenance, freshness timestamps, and
proposed local-only diff records without changing the normal table view.
row count, and total row count so agents can tell whether the user is looking
at the full database or a constrained slice. It also includes a capped
`databaseVisibleItems` summary
with row item IDs, document IDs, titles, positions, and visible property value
summaries for the visible rows, so agents can refer to the same rows and cells
the user can currently scan; for calendar and timeline views this summary is
limited to rows in the current visible date window plus rows shown in the
"No date" section. When footer calculations are active, navigation
state also includes `databaseCalculationResults` with the visible result text
for each calculated column. When table rows are selected, navigation state also
includes `databaseSelectedItemCount` and `databaseSelectedItems`, and
`view-screen.databaseCurrentView` mirrors that selected row summary.
`view-screen` exposes the same slice as `databaseCurrentView` alongside the full
database payload. Its row property summaries should mirror the active database
view's property order, hidden-property list, and empty-property visibility
rules. It also marks database page entries in
`documentTree.items[].database`, matching the sidebar's database icon fallback
so agents can distinguish database pages from ordinary pages.
Database views render the row page's custom icon anywhere a row title appears,
falling back to the default page icon when the row has no icon. The database
side preview exposes the same icon picker affordance as a normal page, so users
can set or remove a row page icon without leaving the database. The preview is
an overlay-free, non-modal side peek so the database context stays visible while
the row page is open. Background database interactions should not dismiss it;
use the explicit close control to close the preview. Keep it narrow enough on
desktop that the underlying database still reads as the active context. In table
views, clicking a row title opens that side preview; inline title editing lives
behind the hover pencil affordance.

Document properties are SQL-backed, Notion-style structured metadata rather
than YAML embedded in the markdown body. Database property definitions support
`text`, `number`, `select`, `multi_select`, `status`, `date`, `person`,
`place`, `files_media` (`Files & media`), `checkbox`, `url`, `email`,
`phone`, `blocks` (Capacities-style rich-text body field), plus computed
`formula`, `id`, `created_time`, `created_by`, and
`last_edited_time`, `last_edited_by`, plus property visibility (`always_show`,
`hide_when_empty`, `always_hide`). The value table stores per-row-document JSON
values.

**Blocks fields.** A `blocks` field is independent rich-text content per row —
NOT YAML and NOT a pointer to the body. Every database is seeded with one
primary "Content" Blocks field whose content is backed by `documents.content`
(so it reuses the collaborative TipTap/Yjs body editor and existing data
migrates for free). Each additional Blocks field stores its own content in
`document_block_field_contents`, keyed by `(document_id, property_id)`, so no
two Blocks fields ever share content — adding a second Blocks field creates a
new, empty, independent field. On the page: one Blocks field renders chromeless
(no header, just the body); two or more each show their name as a header and are
collapsible and reorderable (the surviving lone field keeps its stored name).
In table views a Blocks column shows a word count (e.g. "412 words"), not the
body. A Blocks field can only be deleted from the database view's column menu
(not from the page body); deleting the last Blocks field warns that it removes
the body for every object of the type. Formula properties store their expression in property options and support
`{Property name}` substitution plus simple numeric math such as `{MSV} * 2`.
Database views support multiple named table, list, gallery, board, calendar, and timeline views saved in
`content_databases.view_config_json`. Each view has its own stacked sorts,
type-aware filters with an all/any match mode, per-view hidden property IDs,
column widths, and (for table, list, gallery, and board views) grouping property
or (for calendar/timeline views) date property: text-like fields can use contains/exact/empty
filters, numbers support comparisons, dates support before/after, and
checkboxes support checked/unchecked. Users can reorder stacked sort and filter
conditions from the database toolbar menus, and sort priority follows the same
top-to-bottom order shown in the menu. New rows created from a filtered UI view
inherit simple editable equality and checkbox filters as initial property
values, resolving option labels back to stable option IDs for select, status,
and multi-select filters, so a row created under "Status is Published" remains
visible instead of immediately disappearing. Agents can mirror that behavior by passing
`--propertyValues '{"propertyId":"value"}'` to `add-database-item`. Filter
controls are type-aware: option properties choose from their configured options,
option value editors can search existing options or create a new option from
the typed query, and property settings can rename option labels or change option
colors while preserving stable option IDs. Option-backed filter value pickers
are searchable, can create a new option from the typed query, and can be
cleared without removing the whole filter row. Date properties use date inputs,
and number properties use numeric inputs.
Column header menus can add or clear column sorts, add or replace
type-aware quick filters (including checked/unchecked for checkbox fields),
clear filters for that column, hide property
columns in the current view without changing other views, and resize column
widths. Column headers show compact sort/filter indicators when that column
has active view constraints. Table rows can be selected with row checkboxes, and
the table shows a compact selected-row bar with clear, duplicate, confirmed
delete, and bulk property set actions for editable non-computed fields. Empty table cells stay visually blank while remaining clickable
for editing, and checkbox table cells render as compact checkbox glyphs instead
of "Checked"/"Unchecked" text; clicking a checkbox cell toggles it directly via
`set-document-property`, matching Notion's quieter table surface. Table views
can toggle wrapped cells and row density per view for longer text-heavy tables
or more compact scanning. Table, list, and gallery views can group rows by
status, select, multi-select, or checkbox properties; creating a page inside a
group seeds the grouped property so the new page stays in that group. Grouped
table, list, and gallery sections can be collapsed individually or all at once
per view, and views can hide empty groups to reduce option-backed clutter. Active search, sort, and filter
constraints show as removable chips below the toolbar with a clear-all control,
and every database view shows a Notion-style page count footer that switches to
"count of total" when search or filters reduce the result set. Table views can also save per-column footer
calculations such as count values, count empty, percent empty, sum, average,
count all rows, count unique values, percent filled, checkbox checked/unchecked
summaries, percent checked/unchecked, min/max/median/range numbers, and
earliest/latest/date-range dates in the active view config. Empty constrained views show a clear
search/filter recovery action in the view body. The database Properties menu can
search fields and show or hide all fields for the current view, and it includes
a New property control for adding fields without returning to the table header.
The New property picker supports searching property types by label or machine
name. In unconstrained table views, row drag handles can reorder database item
pages through `move-database-item`; clear search, sort, and filters before
manual reordering. Creating a database row returns the created item IDs and
opens the new row page in the side preview. Duplicating a database row returns
the duplicate item IDs and opens the copied row in the side preview so users can
continue editing the new page immediately, including from table, list, and
gallery row action menus. Board, calendar, and timeline cards expose the same
row action menu without showing table-only manual reorder actions. Deleting the
currently previewed row from any row action menu or from the side preview header
advances to the next row, falls back to the previous row, or closes the preview
when no rows remain. List views render the same row pages as a compact page list
with visible property metadata. Gallery views
render row pages as cards with a preview area and visible property metadata.
Calendar views render row pages on a month grid using a `date`, `created_time`,
or `last_edited_time` property; when the selected date property is editable,
creating a page from a day sets that page's date property to the day. Calendar
and timeline views keep rows without the selected date value reachable in a
compact "No date" section instead of treating them as missing search results.
If a calendar or timeline view has not saved a date property yet, the UI and
`view-screen` both use the same first available date-like property fallback.
Timeline views render the same date-backed row pages in a horizontally
scrollable six-week range, using a per-view start date property and optional
end date property so cards can span multiple days.
The active view menu can rename, duplicate, delete, or switch an existing
view's layout between table, list, gallery, calendar, timeline, and board while
preserving its sorts, filters, hidden properties, and layout-specific settings.
Board views group
pages by status, select, multi-select, or checkbox
properties, and board columns can be collapsed per view using the same
`collapsedGroupIds` state as grouped table/list/gallery sections, including
collapse-all and expand-all group commands. Board views also honor the per-view
empty-group visibility setting. Changing the group-by property clears stale
collapsed group IDs for that view. Board card
metadata follows the same active-view hidden-property and empty-property
visibility rules as table/list/gallery metadata. Dragging a board card between
columns updates that row page's grouping property through
`set-document-property`. When a board is grouped by status, select, or
multi-select, users can add a new board group from the board itself; this
appends a new option to the grouped property definition.
Use
`create-content-database`, `get-content-database`,
`add-database-item`, `duplicate-database-item`, `duplicate-database-items`,
`delete-database-items`, `move-database-item`,
`update-content-database-view`, `list-document-properties`,
`configure-document-property`, `set-document-property`,
`duplicate-document-property`, and `delete-document-property`; do not edit
property rows or view config via raw SQL when an action can do it.
When targeting more than one database row, call `duplicate-database-items` or
`delete-database-items` once with a native JSON array of `itemIds` or
`documentIds`. Do not loop `duplicate-database-item` or `delete-document` for
multi-row duplicate/delete requests.

## UI Components

**Always use shadcn/ui components** from `app/components/ui/` for all standard UI patterns (dialogs, popovers, dropdowns, tooltips, buttons, etc). Never build custom modals or dropdowns with absolute/fixed positioning — use the shadcn primitives instead.

**Always use Tabler Icons** (`@tabler/icons-react`) for all icons. Never use other icon libraries.

**Never use browser dialogs** (`window.confirm`, `window.alert`, `window.prompt`) — use shadcn AlertDialog instead.

## Rules

1. **Use scripts for document operations** — NEVER use raw `db-exec` SQL for documents. Always use `edit-document` or `update-document`. The editor uses real-time Yjs collaboration — raw SQL changes won't appear in the user's editor.
2. **Prefer `edit-document` for changes** — use `edit-document --find "old" --replace "new"` for modifications. It's faster (no full regeneration) and syncs live to the editor via Yjs CRDT.
3. **Screen context is auto-included** — check `<current-screen>` in the user's message before acting
4. **Use markdown for content** — documents store content as markdown
5. **All AI goes through agent chat** — never call an LLM directly from code
6. **Run `refresh-list` after changes** — the create/update/delete scripts do this automatically
