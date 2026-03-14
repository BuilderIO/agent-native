# Ahrefs MCP Tool Mapping

Canonical reference for all Ahrefs MCP tool calls used across the content pipeline. Other skills should cross-reference this file rather than duplicating it.

**Critical:** Always call `mcp__claude_ai_ahrefs__doc` with the tool name first to get the real input schema before making any call. The schemas below are accurate as of 2026-02-08 but may change.

## API Unit Management

Call `subscription-info-limits-and-usage` at the start of every workflow to check remaining units.

**Estimated units per blog post:** 1,800-2,000 total across all phases.

**Unit budget thresholds (check at workflow start):**

| Remaining Units | Action |
|----------------|--------|
| >= 10,000 | Proceed normally with full field selection |
| 5,000 - 9,999 | Proceed with reduced fields: drop `intents`, `global_volume`, `parent_volume` |
| 2,000 - 4,999 | Warn user. Use only `keywords-explorer-overview`. Supplement with WebSearch. |
| < 2,000 | Warn user. Switch entirely to WebSearch fallback. Mark `data_source: estimated`. |

Always display to user: "Ahrefs API: X units remaining (resets YYYY-MM-DD). This workflow will use ~1,800 units."

**Cost-saving rules:**
- Set `limit: 20-50` (default is 1000)
- Use `where` for server-side filtering instead of fetching all results and filtering locally
- Request only needed `select` fields -- each field with a unit cost annotation (e.g., "10 units") adds to the total
- Monetary values (e.g., `cpc`) are returned in USD cents -- divide by 100 for dollars

## Keyword Research Tools

### keywords-explorer-overview

**Purpose:** Get core metrics for a specific keyword -- volume, difficulty, traffic potential, intent, parent topic.

**Used by:** Topic Discovery (Phase 1), Keyword Research (Phase 2)

**Required params:** `select`, `country`

**Example call:**

```json
{
  "select": "keyword,volume,difficulty,traffic_potential,intents,parent_topic,parent_volume,serp_features",
  "country": "us",
  "keywords": "react server components"
}
```

**Key output fields:**

| Field | Unit Cost | Description |
|-------|-----------|-------------|
| `keyword` | 0 | The keyword string |
| `volume` | 10 | Monthly search volume (12-month average) |
| `difficulty` | 10 | Ranking difficulty (0-100 scale) |
| `traffic_potential` | 10 | Total organic traffic the #1 page gets from ALL its keywords |
| `intents` | 10 | Object with boolean fields: `informational`, `navigational`, `commercial`, `transactional`, `branded`, `local` |
| `parent_topic` | 0 | The broader topic the #1 page actually ranks for |
| `parent_volume` | 10 | Search volume of the parent topic |
| `serp_features` | 0 | Array of SERP features present (e.g., `ai_overview`, `snippet`, `video`) |
| `global_volume` | 10 | Monthly volume across all countries |
| `cpc` | 0 | Cost per click in USD cents |
| `clicks` | 0 | Average monthly clicks on search results |

### keywords-explorer-matching-terms

**Purpose:** Find keyword variations and question-form keywords.

**Used by:** Keyword Research (Phase 2)

**Required params:** `select`, `country`

**Example call -- all variations:**

```json
{
  "select": "keyword,volume,difficulty,traffic_potential",
  "country": "us",
  "keywords": "react server components",
  "terms": "all",
  "match_mode": "terms",
  "limit": 30,
  "order_by": "traffic_potential:desc",
  "where": "{\"and\":[{\"field\":\"volume\",\"is\":[\"gte\",100]},{\"field\":\"difficulty\",\"is\":[\"lte\",60]}]}"
}
```

**Example call -- question keywords only:**

```json
{
  "select": "keyword,volume,difficulty,traffic_potential",
  "country": "us",
  "keywords": "react server components",
  "terms": "questions",
  "limit": 20,
  "order_by": "volume:desc",
  "where": "{\"and\":[{\"field\":\"volume\",\"is\":[\"gte\",50]}]}"
}
```

**Params specific to this tool:**

| Param | Values | Description |
|-------|--------|-------------|
| `terms` | `all`, `questions` | `questions` returns only question-form keywords (for AEO headings) |
| `match_mode` | `terms`, `phrase` | `terms` = words in any order; `phrase` = exact order |

### keywords-explorer-related-terms

**Purpose:** Find secondary keywords (`also_rank_for`) and semantic depth keywords (`also_talk_about`).

**Used by:** Keyword Research (Phase 2)

**Required params:** `select`, `country`

**Example call -- secondary keywords:**

```json
{
  "select": "keyword,volume,difficulty,traffic_potential",
  "country": "us",
  "keywords": "react server components",
  "terms": "also_rank_for",
  "limit": 30,
  "order_by": "traffic_potential:desc",
  "where": "{\"and\":[{\"field\":\"volume\",\"is\":[\"gte\",100]},{\"field\":\"difficulty\",\"is\":[\"lte\",60]}]}"
}
```

**Example call -- semantic/LSI keywords:**

```json
{
  "select": "keyword,volume",
  "country": "us",
  "keywords": "react server components",
  "terms": "also_talk_about",
  "limit": 30
}
```

**Params specific to this tool:**

| Param | Values | Description |
|-------|--------|-------------|
| `terms` | `also_rank_for`, `also_talk_about`, `all` | `also_rank_for` = secondary keyword targets; `also_talk_about` = semantic depth terms for article body |

**Dual-call strategy:** Always make two separate calls -- one for `also_rank_for` (secondary keywords) and one for `also_talk_about` (semantic keywords). They serve different purposes.

### keywords-explorer-volume-history

**Purpose:** Check if a keyword is trending up, stable, or declining.

**Used by:** Topic Discovery (Phase 1), Keyword Research (Phase 2)

**Required params:** `country`, `keyword`

**Example call:**

```json
{
  "country": "us",
  "keyword": "react server components",
  "date_from": "2025-02-01",
  "date_to": "2026-02-01"
}
```

**Output:** Array of `{date, volume}` objects showing monthly volume over the specified period.

**Trend classification:**
- **Rising:** Last 3 months average > first 3 months average by 20%+
- **Stable:** Less than 20% variance between periods
- **Declining:** Last 3 months average < first 3 months average by 20%+

## SERP Analysis Tools

### serp-overview

**Purpose:** Get the top 10 search results for a keyword with domain metrics and SERP features.

**Used by:** SERP Analysis (Phase 3)

**Required params:** `select`, `country`, `keywords`

**Example call:**

```json
{
  "select": "keyword,position,title,url,domain_rating,url_rating,traffic,refdomains,backlinks,page_type",
  "country": "us",
  "keywords": "react server components",
  "limit": 10
}
```

**Note:** Call `mcp__claude_ai_ahrefs__doc` with `tool: "serp-overview"` for the complete schema -- the `serp-overview` tool has additional fields not listed here.

### site-explorer-organic-keywords

**Purpose:** See what keywords a specific competing URL/domain ranks for.

**Used by:** SERP Analysis (Phase 3)

**Required params:** `select`, `target`, `country`

**Example call:**

```json
{
  "select": "keyword,position,volume,traffic,difficulty,intents",
  "target": "competitor.com/blog/react-server-components",
  "target_mode": "prefix",
  "country": "us",
  "limit": 30,
  "order_by": "traffic:desc"
}
```

### site-explorer-organic-competitors

**Purpose:** Identify domains that compete for similar keywords.

**Used by:** SERP Analysis (Phase 3)

**Required params:** `select`, `target`, `country`

**Example call:**

```json
{
  "select": "domain,common_keywords,keywords,traffic",
  "target": "builder.io",
  "target_mode": "domain",
  "country": "us",
  "limit": 10,
  "order_by": "common_keywords:desc"
}
```

**Note:** Call `mcp__claude_ai_ahrefs__doc` with `tool: "site-explorer-organic-competitors"` for the complete schema.

### site-explorer-top-pages

**Purpose:** Find a competitor's highest-traffic content.

**Used by:** SERP Analysis (Phase 3)

**Required params:** `select`, `target`, `country`

**Example call:**

```json
{
  "select": "url,traffic,keywords,top_keyword",
  "target": "competitor.com",
  "target_mode": "domain",
  "country": "us",
  "limit": 20,
  "order_by": "traffic:desc"
}
```

**Note:** Call `mcp__claude_ai_ahrefs__doc` with `tool: "site-explorer-top-pages"` for the complete schema.

## AEO Tools

### brand-radar-ai-responses

**Purpose:** See how AI assistants (ChatGPT, Perplexity, etc.) discuss a brand or topic.

**Used by:** AEO Optimization (Phase 9)

**Priority:** Recommended (not required)

**Note:** Call `mcp__claude_ai_ahrefs__doc` with `tool: "brand-radar-ai-responses"` for the complete schema.

### brand-radar-cited-pages

**Purpose:** See which pages get cited by AI assistants.

**Used by:** AEO Optimization (Phase 9)

**Priority:** Recommended (not required)

**Note:** Call `mcp__claude_ai_ahrefs__doc` with `tool: "brand-radar-cited-pages"` for the complete schema.

## Utility Tools

### subscription-info-limits-and-usage

**Purpose:** Check remaining API units before starting a workflow.

**Used by:** All phases (call at workflow start)

**Example call:** No parameters required.

### batch-analysis

**Purpose:** Quick domain rating and traffic comparison across multiple URLs.

**Used by:** SERP Analysis (Phase 3) -- optional

**Priority:** Optional (use when comparing 5+ competitor domains quickly)

**Note:** Call `mcp__claude_ai_ahrefs__doc` with `tool: "batch-analysis"` for the complete schema.

## Where Filter Syntax

The `where` parameter accepts a JSON filter expression. Common patterns:

**Filter by volume and difficulty:**
```json
{"and":[{"field":"volume","is":["gte",100]},{"field":"difficulty","is":["lte",60]}]}
```

**Filter by traffic potential:**
```json
{"field":"traffic_potential","is":["gte",1000]}
```

**Filter by word count (long-tail):**
```json
{"and":[{"field":"volume","is":["gte",50]},{"field":"word_count","is":["gte",4]}]}
```

**Filter informational intent:**
```json
{"field":"intents","is":["eq",{"informational":true}]}
```

**Operators:** `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `substring`, `isubstring`, `phrase_match`, `iphrase_match`, `prefix`, `suffix`, `regex`, `empty`, `is_null`

**Combinators:** `and`, `or`, `not` (nest filter expressions)
