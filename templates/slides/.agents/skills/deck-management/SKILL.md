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
  created_at TEXT DEFAULT (current_timestamp),
  updated_at TEXT DEFAULT (current_timestamp)
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
pnpm script list-decks

# Get a specific deck with all slides
pnpm script get-deck --id=<deckId>

# See what the user is looking at
pnpm script view-screen
```

**From the API:**

- `GET /api/decks` -- list all decks (returns id, title, slide count, timestamps)
- `GET /api/decks/:id` -- get a single deck with full data

## Writing Decks

**From scripts:**

```bash
# Use db-exec to insert/update
pnpm script db-exec --sql "INSERT INTO decks (id, title, data) VALUES (?, ?, ?)" --params '["new-id", "Title", "{...}"]'
```

**From the API:**

- `POST /api/decks` -- create a new deck
- `PUT /api/decks/:id` -- update an existing deck
- `DELETE /api/decks/:id` -- delete a deck

## Important Rules

1. **Always use the API or Drizzle** -- never write raw JSON files for deck storage
2. **Deck IDs are stable** -- once created, a deck's ID doesn't change
3. **Slide IDs within a deck are stable** -- used for referencing specific slides
4. **The `data` column is the full source of truth** -- title is duplicated at the top level for listing queries
5. **SSE events** (`source: "resources"`) fire when decks change, keeping the UI in sync
