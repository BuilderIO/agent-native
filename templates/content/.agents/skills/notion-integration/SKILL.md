---
name: notion-integration
description: >-
  How Notion sync works. Covers connecting, linking pages, pulling from Notion,
  pushing to Notion, and checking sync status.
---

# Notion Integration

The content app can sync documents bidirectionally with Notion. Documents can be linked to Notion pages, pulled from Notion, or pushed to Notion.

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
pnpm action link-notion-page --documentId abc123 --notionPageId notion-page-id
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

## Sync State

The `document_sync_links` table tracks sync relationships:

| Column                         | Description                                |
| ------------------------------ | ------------------------------------------ |
| `document_id`                  | Local document ID                          |
| `provider`                     | Always "notion"                            |
| `remote_page_id`               | Notion page ID                             |
| `state`                        | "linked", "syncing", "error"               |
| `last_synced_at`               | Timestamp of last successful sync          |
| `has_conflict`                 | Whether there's a merge conflict (0 or 1)  |
| `last_error`                   | Error message if sync failed               |

## Common Tasks

| User says                          | What to do                                            |
| ---------------------------------- | ----------------------------------------------------- |
| "Is Notion connected?"             | `connect-notion-status`                               |
| "Link this doc to Notion"          | `link-notion-page --documentId ... --notionPageId ...`|
| "Pull from Notion"                 | `pull-notion-page --documentId ...`                   |
| "Push to Notion"                   | `push-notion-page --documentId ...`                   |
| "Show Notion-linked documents"     | `list-notion-links`                                   |

## Important Notes

- Notion sync requires a connected Notion integration (API key configured in settings)
- Pull overwrites local content; push overwrites Notion content — there is no automatic merge
- The `has_conflict` flag is set when both sides have changed since last sync
- Always check `connect-notion-status` before attempting sync operations
