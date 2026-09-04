---
name: dataforseo
description: >
  Query keyword rankings, search volume, and SEO metrics via DataForSEO.
  Use this skill when the user asks about SEO performance, keyword rankings, or organic search data.
---

# DataForSEO Integration

## Connection

- **Base URL**: `https://api.dataforseo.com/v3`
- **Auth**: Basic auth — `Base64($DATAFORSEO_LOGIN:$DATAFORSEO_PASSWORD)`
- **Env vars**: `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`
- **Caching**: 6-hour in-memory cache, max 50 entries

## Server Lib

- **File**: `server/lib/dataforseo.ts`

### Exported Functions

| Function                                     | Description                            |
| -------------------------------------------- | -------------------------------------- |
| `getRelevantBlogPages(limit?, offset?)`      | Blog pages with SEO metrics            |
| `getAllBlogPagesSeo()`                       | All blog pages (paginated, up to 1000) |
| `getTopBlogKeywords(limit?, offset?)`        | Top ranking keywords                   |
| `getAllTopBlogKeywords(maxResults?)`         | All top keywords                       |
| `getRankedKeywordsForPage(blogSlug, limit?)` | Keywords for a specific blog post      |

## Script Usage

```bash
# Top keywords
pnpm action seo-top-keywords --fields=keyword,rank_absolute,etv

# Search for specific keywords
pnpm action seo-top-keywords --grep=remix --fields=keyword,rank_absolute,etv
```

## Key Patterns & Gotchas

- API uses asynchronous tasks model — response has `tasks[]` with `status_code: 20000` for success
- Response structure: `tasks[].result[0].items` — code drills into this
- Filtering uses SQL-like filter arrays in request body; code filters for `/blog/%`
- `getAllBlogPagesSeo` paginates in steps of 100, up to 1000 by default
- Errors include DataForSEO task status codes/messages
