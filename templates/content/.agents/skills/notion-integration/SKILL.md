---
name: notion-integration
description: >-
  How Notion sync works. Covers connecting, linking pages, pulling from Notion,
  pushing to Notion, and checking sync status.
---

# Notion Integration

The content app can sync documents bidirectionally with Notion. Documents can be linked to Notion pages, pulled from Notion, or pushed to Notion.

Notion sync is not creative-context retrieval. When drafting new copy from a
synced page, read the `creative-context` skill first and retrieve voice,
terminology, audience guidance, and factual evidence as separate roles. Apply
its exact reuse ladder, respect opt-out/pinned packs, and use app-local Notion
content as the fallback when the shared corpus has no relevant evidence. Keep
the resulting immutable `contextPackId` and reuse labels with document
generation provenance; never infer them from a later Notion sync snapshot.

## Scripts

### connect-notion-status

Check the Notion connection status.

```bash
pnpm action connect-notion-status
```

Returns whether a Notion integration is connected and which workspace it belongs to.

### link-notion-page

Link a local document to a Notion page for syncing.

```bash
pnpm action link-notion-page --documentId abc123 --pageId <notion-page-id-or-url>
```

`--pageIdOrUrl` and `--url` are accepted aliases for `--pageId`. There is no
`--notionPageId` flag — passing it is silently dropped by the action's schema
and the action fails with "documentId and pageId are required".

### create-and-link-notion-page

Create a brand-new Notion page from a Content document's current content and
link it in one step (instead of creating in Notion first and linking after).

```bash
pnpm action create-and-link-notion-page --documentId abc123 [--parentPageIdOrUrl <id-or-url>]
```

### unlink-notion-page

Remove the sync link between a document and its Notion page without deleting
either side's content.

```bash
pnpm action unlink-notion-page --documentId abc123
```

### list-notion-links

List all documents that are linked to Notion pages.

```bash
pnpm action list-notion-links
```

### pull-notion-page

Pull content from a linked Notion page into the local document.

```bash
pnpm action pull-notion-page --documentId abc123
```

This overwrites the local document's content with the Notion page's content, converted to markdown.

### push-notion-page

Push local document content to the linked Notion page.

```bash
pnpm action push-notion-page --documentId abc123
```

This overwrites the Notion page's content with the local document's markdown, converted to Notion blocks.

### refresh-notion-sync-status

Check (and optionally auto-sync) the current sync status of a linked document.
This is what the editor UI polls every few seconds while a document is open.

```bash
pnpm action refresh-notion-sync-status --documentId abc123 [--autoSync true]
```

### resolve-notion-sync-conflict

Resolve a document whose link is in the `conflict` state (both sides changed
since the last sync) by picking a direction.

```bash
pnpm action resolve-notion-sync-conflict --documentId abc123 --direction pull|push
```

### sync-notion-comments

Sync comments bidirectionally between a document and its linked Notion page.

```bash
pnpm action sync-notion-comments --documentId abc123
```

### search-notion-pages

Search Notion pages visible to the current user's connected workspace (used to
find a page to link to).

```bash
pnpm action search-notion-pages --query "meeting notes"
```

### list-notion-database-sources

List Notion data sources visible to the current user's OAuth connection before
attaching one to a Content collection:

```bash
pnpm action list-notion-database-sources --query "projects"
```

The database-source pilot is read-only and uses the same per-user OAuth
connection as page sync. Choose a returned data-source ID, run
`suggest-source-join-key`, then attach it with
`attach-content-database-source --sourceType notion-database
--relationshipMode details`. Use `refresh-content-database-source` to pull a
new bounded snapshot. Never use a pasted token or claim Notion write-back.

### disconnect-notion

Disconnect the current user's Notion OAuth connection.

```bash
pnpm action disconnect-notion
```

## Raw Notion Provider API

Treat the Notion workflow actions above as shortcuts, not capability limits.
When the exact Notion endpoint, filter, pagination mode, or API version matters,
use `provider-api-catalog`, `provider-api-docs`, and `provider-api-request`
against the real Notion API. The provider API resolves auth from the user's
Notion OAuth connection, never from `NOTION_API_KEY`. For large scans, stage
results with `stageAs` and analyze them with `query-staged-dataset`.

## How Sync Works (Architecture)

Documents are stored as **Notion-Flavored Markdown (NFM)** — the exact format
Notion's `/pages/{id}/markdown` API emits and accepts. The storage form is
Notion's _canonical_ form, so a synced document is byte-identical on both sides,
apart from line breaks in inline code (below).

- `shared/nfm.ts` is the single deterministic converter: `nfmToDoc` (NFM →
  ProseMirror JSON) and `docToNfm` (ProseMirror JSON → NFM), plus
  `canonicalizeNfm = docToNfm ∘ nfmToDoc`. It is used by **both** the editor
  (`setContent(nfmToDoc(x))` / `docToNfm(editor.getJSON())`) and the server
  (pull canonicalization + content hashing).
- The converter is a proven **fixpoint**: `docToNfm(nfmToDoc(x)) === x` for all
  canonical NFM `x`, verified by `shared/nfm.spec.ts` (pure) and
  `app/components/editor/nfm-editor.roundtrip.test.ts` (real TipTap schema).
  Because our canonical form equals Notion's emission, pull→edit→push→pull
  never drifts.
- Inline code is the one exception. Between backticks, Notion's markdown reads
  `<br>` as a line break, while Content's keeps it as text. Pulls go through
  `notionMarkdownToNfm`, which reads Notion's way, so a line break in Notion's
  inline code arrives as one and is saved as `` `a`<br>`b` ``, which Notion
  reads the same, though Notion itself sends `` `a<br>b` ``. A `<br>` typed in
  Content's inline code still becomes a line break once pushed: Notion's v1
  markdown has no documented way to keep it as text. Its v2 markdown keeps
  text in code literal, as Content does.
- Content read a `<br>` between backticks as a line break before sync
  baselines moved to `v3:`. A linked page last synced before that which still
  holds one reads as changed in Notion, so auto-sync pulls it once and the line
  break comes back. A `v2:` baseline whose digest still matches says the page
  is unchanged; one that doesn't falls back to timestamps.
- Pulls also materialize accessible Notion child pages referenced by `<page>`
  atoms. Each child becomes a local `documents` row with `parent_id` set to the
  pulled parent and a `document_sync_links` row pointing at the child Notion
  page, so the sidebar tree and page blocks can open the same local subpage.
  Inaccessible child pages remain preserved as NFM page references.
- **Do not** route Notion content through `shared/notion-markdown.ts` (the old
  tiptap-markdown bridge). It is retained only for clipboard copy/paste.

Supported losslessly: paragraphs, headings (incl. toggle headings via
`{toggle="true"}`), bulleted/numbered/to-do lists with tab nesting, real quote
blocks (multi-line via `<br>`), block colors (`{color="…"}`), inline
bold/italic/strike/code/underline/color/background and links, inline + block
equations, code blocks, dividers, `<empty-block/>`, callouts, toggles, columns,
tables (header row/column, cell/row colors), images/audio/video/file/pdf, page
and database references, synced blocks (children preserved), mentions, and
backslash-escaped special characters. A list item's, callout's, toggle's,
column's, or synced block's children sit one tab deeper than its line or tags.
Visual indentation is a block `indent` attribute (Tab indents a block,
matching Notion).

Code block wrapping (`{wrap="true"}` after a fence's language) has no Notion
equivalent: `canonicalizeNotionNfm` leaves it out of pushes and sync hashes,
and `keepCodeBlockWrap` puts it back on the blocks whose code Notion returns
unchanged, so toggling it is not a change to sync.

Interactive HTML (`html interactive` code blocks) can't run in Notion. A push
writes each as an `html` code block whose first line is
`<!-- Runs in Content: <url> -->`, followed by a paragraph that is only a link
to that URL (`interactiveHtmlForNotion`). A pull reads a code block that starts
with that comment as the block, with any edits made to its code, and drops the
link right below it (`notionMarkdownToNfm`). A code block whose comment is gone
comes back as plain code, and its link stays a link.

## Sync State

The `document_sync_links` table tracks sync relationships:

| Column                     | Description                                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `document_id`              | Local document ID                                                                                                                |
| `provider`                 | Always "notion"                                                                                                                  |
| `remote_page_id`           | Notion page ID                                                                                                                   |
| `state`                    | "linked", "syncing", "error", "conflict"                                                                                         |
| `last_synced_at`           | Timestamp of last successful sync                                                                                                |
| `last_synced_content_hash` | SHA-256 of the canonical content identical on both sides — the authoritative "did it change" signal (immune to timestamp jitter) |
| `has_conflict`             | Whether both sides changed since last sync (0 or 1)                                                                              |
| `last_error`               | Error message if sync failed                                                                                                     |

Conflict detection is **content-hash based**: a side has "changed" only when its
canonical content hash differs from `last_synced_content_hash`. A no-op sync
(identical canonical content) is never mistaken for an edit — this is what keeps
the two copies from drifting.

## Common Tasks

| User says                      | What to do                                             |
| ------------------------------ | ------------------------------------------------------ |
| "Is Notion connected?"         | `connect-notion-status`                                |
| "Link this doc to Notion"      | `link-notion-page --documentId ... --pageId ...`       |
| "Pull from Notion"             | `pull-notion-page --documentId ...`                    |
| "Push to Notion"               | `push-notion-page --documentId ...`                    |
| "Show Notion-linked documents" | `list-notion-links`                                    |

## Important Notes

- Notion access is **per-user OAuth only**. Never read `NOTION_API_KEY` from the
  environment or `process.env`, never accept a user-pasted token or save a
  user-entered Notion token through `/_agent-native/env-vars`, and require
  editor access for routes that pull or push Notion content.
- Pull replaces local content with Notion's; push replaces Notion's with local.
  When both sides changed since the last sync the link enters `conflict` state and
  the user resolves it (pull-wins or push-wins) — there is no line-level merge.
  A push that isn't forced keeps a recorded conflict until the hashes show
  Notion unchanged, and an auto-sync pull that finds only a local edit leaves
  it for a push.
- Because storage is canonical NFM, a no-op sync changes nothing: editing the
  same document in Notion and in the app will not create growing inconsistencies.
- Always check `connect-notion-status` before attempting sync operations.
- A Notion export is a one-time copy, not a sync. The Import dialog takes the
  export's `.zip` (Markdown & CSV, with subpages); `import-content` takes the
  files inside it and rebuilds the page tree, but lists databases as not
  imported yet (see `document-editing`). Link and pull pages that should stay
  in sync with Notion.
