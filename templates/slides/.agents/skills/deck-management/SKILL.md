---
name: deck-management
description: How decks are stored in SQL, how to create/read/update/delete decks. Read before working with deck data.
---

# Deck Management

Decks are stored in the `decks` SQL table via Drizzle ORM. Each deck row contains the full deck JSON (slides, metadata) in a `data` TEXT column.

## Schema

```sql
CREATE TABLE decks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  data TEXT NOT NULL,       -- Full deck JSON (slides array, metadata)
  design_system_id TEXT,
  created_at TEXT DEFAULT (current_timestamp),
  updated_at TEXT DEFAULT (current_timestamp),
  owner_email TEXT NOT NULL DEFAULT 'local@localhost',
  org_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
);
```

## Deck JSON Structure

The `data` column stores a JSON object:

```json
{
  "title": "My Presentation",
  "slides": [
    {
      "id": "slide-1",
      "content": "<div class=\"fmd-slide\" style=\"...\">...</div>",
      "layout": "title"
    },
    {
      "id": "slide-2",
      "content": "<div class=\"fmd-slide\" style=\"...\">...</div>",
      "layout": "content"
    }
  ]
}
```

Each slide has an `id`, HTML `content`, and optional `layout` type.

## Reading Decks

**From scripts:**

```bash
# List all decks (metadata only)
pnpm action list-decks

# Get a specific deck with all slides
pnpm action get-deck --id=<deckId>

# Get one slide's full HTML without loading the rest of the deck
pnpm action get-deck --id=<deckId> --slideId=<slideId> --compact=false

# See what the user is looking at
pnpm action view-screen
```

**From actions:**

- `list-decks` -- list all decks (returns id, title, slide count, timestamps)
- `get-deck` -- get a single deck; Slides chat calls are compact by default.
  Pass `slideId` for one targeted slide (full HTML by default), or use
  `compact=false` when a full deck read is actually needed

## Writing Decks

Never write the `decks` table directly -- no `db-exec` (this app has no such
action), no raw SQL. Every write goes through an action so ids, access checks,
`notifyClients` events, and version snapshots stay correct.

- `create-deck` -- create a deck (the agent's only creation path; `add-deck`
  is the browser editor's optimistic client-id flow and is hidden from the
  agent)
- `add-slide` -- append one slide
- `update-slide` -- edit one slide (see `slide-editing`)
- `patch-deck` -- delete/reorder slides, deck-wide or multi-slide changes
- `delete-deck` -- delete a deck and its version history

`save-deck` is a full-payload replace reserved for undo/redo and bulk
replacement; it is hidden from the agent so concurrent writers on different
slides do not clobber each other.

## Important Rules

1. **Always use the API or Drizzle** -- never write raw JSON files for deck storage
2. **Deck IDs are stable** -- once created, a deck's ID doesn't change
3. **Slide IDs within a deck are stable** -- used for referencing specific slides
4. **The `data` column is the full source of truth** -- title is duplicated at the top level for listing queries
5. **SSE events** (`source: "resources"`) fire when decks change, keeping the UI in sync

## PDF Round Trip

A PDF page is a picture of a slide, not the slide. `exportDeckAsPdf`
(`app/lib/export-pdf-client.ts`) therefore writes three layers per page: the
rendered page image, the slide's own text drawn over it invisibly, and — once
for the document — the deck source as base64 JSON in the PDF's XMP metadata
(`shared/pdf-sidecar.ts` owns that format and its size cap).

`import-file` reads them back in that order of preference
(`server/handlers/import/pdf-sidecar-reader.ts`):

- **Sidecar found** — the PDF came from Slides. The original slide HTML, notes,
  layouts, and aspect ratio are restored verbatim, with fresh slide ids. The
  result carries `restoredFromExport: true`.
- **Sidecar absent** — a foreign PDF. `parsePdfFidelity` rebuilds positioned
  text boxes and placed images from the page itself.
- **Sidecar present but unreadable** — logged loudly, then treated as absent.
  Never report that import as a clean restore.

A PDF import that yields one full-slide image means the page carried nothing
else — a scan or a flattened render. Say that rather than presenting it as a
faithful import, and offer OCR or the original source file instead.
