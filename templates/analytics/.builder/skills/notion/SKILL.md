---
name: notion
description: >
  Access the Notion content calendar and page data for editorial planning.
  Use this skill when the user asks about the content calendar, blog planning, or editorial schedule.
---

# Notion Integration

## Connection

- **Base URL**: `https://api.notion.com/v1`
- **Auth**: `Authorization: Bearer $NOTION_API_KEY`, `Notion-Version: 2022-06-28`
- **Env vars**: `NOTION_API_KEY`
- **Caching**: 10-minute cache for content calendar and individual pages
- **Content DB**: `db4ae46c822443ba96e51a6a352e0fbe` (hard-coded)

## Server Lib

- **File**: `server/lib/notion.ts`

### Exported Functions

| Function                     | Description                                          |
| ---------------------------- | ---------------------------------------------------- |
| `getContentCalendar()`       | Fetch all entries from the content calendar database |
| `getNotionPage(pageId)`      | Fetch a page with its block content (recursive)      |
| `getContentCalendarSchema()` | Get the database schema/properties                   |

## Agent Actions

- `content-calendar` — fetch content calendar entries
- `content-calendar-schema` — fetch the database schema/properties
- `notion-page --pageId <id>` — fetch a page with block content

Do not call `/api/notion/*` directly from the agent.

## Key Patterns & Gotchas

- Content calendar paginates via POST `/databases/:id/query` with `page_size: 100` and `start_cursor`
- `extractProp` handles all Notion property types (title, rich_text, select, multi_select, date, people, rollup, formula, etc.)
- `fetchBlocks` recurses to fetch children when `has_children` is true — can be expensive for deeply nested pages
- Database ID and API version are hard-coded
