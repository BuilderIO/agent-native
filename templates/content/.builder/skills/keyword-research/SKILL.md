---
name: keyword-research
description: "This skill should be used when performing keyword research for a blog post using the Ahrefs MCP server. It covers finding primary keywords, secondary keywords, long-tail variations, question keywords for AEO headings, and semantic keywords for topical depth. Includes viability assessment and fallback behavior."
---

# Keyword Research

Find and evaluate keywords for a blog post using the Ahrefs MCP server. The output feeds SERP Analysis (Phase 3), Outline Creation (Phase 5), and SEO/AEO Optimization (Phases 8-9).

## When to Use This Skill

- After Topic Discovery (Phase 1) has produced a validated topic with `viability: proceed`
- When re-evaluating keywords for an existing post during content refresh

## Prerequisites

- Topic validated in `phases/01-topic-validation.yaml`
- Ahrefs MCP server available (check with `subscription-info-limits-and-usage` first)

## Process

### Step 0: Check Content Timing

Read `content_timing` from `phases/01-topic-validation.yaml`.

**If `content_timing: trending`:** Skip to the Trending Topic Mode section below. Ahrefs data does not exist yet for breaking/just-announced topics.

**If `content_timing: evergreen`:** Continue with Step 0.5.

### Step 0.5: Check for Seed Keywords

Read `seed_detected` from `phases/01-topic-validation.yaml`.

**If `seed_detected: true`:** Check for `seed/keywords.txt` in the output folder. If it exists and has content (non-empty, non-comment lines):

1. Parse seed keywords (one per line, skip comments and blanks)
2. Hold them for merge in Step 7 (after Ahrefs research completes)
3. Query Ahrefs for metrics on each seed keyword using `keywords-explorer-overview` (batch if possible)
4. Mark seed keywords with `source: seed` in the output YAML
5. Note: this adds ~2-4 Ahrefs units per seed keyword to the budget

**If `seed_detected: false` or no keywords.txt:** Continue with Step 1 as normal.

### Step 1: Check Ahrefs API Budget

Before making any calls, check remaining API units:

Call `subscription-info-limits-and-usage` to verify sufficient units remain. Display to the user: "Ahrefs API: X units remaining (resets YYYY-MM-DD). This workflow will use ~1,800 units total."

**Unit budget thresholds:**

| Remaining Units | Action                                                                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| >= 10,000       | Proceed normally with full field selection                                                                                                            |
| 5,000 - 9,999   | Proceed with reduced fields: drop `intents`, `global_volume`, `parent_volume` from select                                                             |
| 2,000 - 4,999   | Warn user. Use only `keywords-explorer-overview` (skip matching-terms and related-terms). Supplement with WebSearch for secondary/long-tail keywords. |
| < 2,000         | Warn user. Switch entirely to WebSearch fallback. Mark `data_source: estimated`.                                                                      |

A full keyword research phase uses approximately 200-400 units (comparison posts: 250-500 units due to per-subject keyword research). The entire blog post workflow uses ~1,800-2,000 units across all phases (comparison posts: ~2,100-2,300).

### Step 2: Get Primary Keyword Metrics

Call `keywords-explorer-overview` with the topic as keyword.

**Required fields:** `keyword,volume,difficulty,traffic_potential,intents,parent_topic,serp_features`

**Key decisions from this call:**

- If `traffic_potential` > `volume` by 2x+, the topic has strong secondary keyword potential
- If `parent_topic` differs from the keyword, consider targeting the parent topic instead (ranking for both with one article)
- If `intents.informational` is true, the topic suits explainer/tutorial formats
- If `intents.commercial` is true, the topic suits comparison/review formats
- If `serp_features` includes `ai_overview`, note that organic CTR is reduced -- AEO optimization becomes critical

**Viability assessment:**

| Condition                                           | Classification                                    |
| --------------------------------------------------- | ------------------------------------------------- |
| difficulty <= 30 AND volume >= 200                  | Strong opportunity                                |
| difficulty <= 50 AND traffic_potential >= 1000      | Worth pursuing                                    |
| difficulty > 50 AND serp has weak players (DR < 50) | Challenging but feasible                          |
| difficulty > 50 AND no weak players                 | Too competitive -- suggest long-tail alternatives |

### Step 2.5: Individual Subject Keyword Research (Comparison Posts Only)

**Only when `post_type == "comparison"` in `phases/01-topic-validation.yaml`.**

Read `comparison_subjects` from Phase 1 output. For each subject, run a separate `keywords-explorer-overview` call to build an individual keyword profile.

For each subject in `comparison_subjects`:

1. Call `keywords-explorer-overview` with the individual subject name (use the disambiguator from `comparison_disambiguators` if available)
2. Record: `volume`, `difficulty`, `traffic_potential`, `parent_topic`, `serp_features`
3. Note what the individual subject ranks for that the comparison keyword does not — these are keyword opportunities the comparison post can capture

**Why this matters:** Individual product queries surface keywords that comparison-only research misses. "Claude Code" alone may surface "claude code mcp", "claude code terminal", "agentic coding" — deep feature keywords that become natural subheadings and differentiation points in the comparison.

**Include individual subject keywords in Step 3 (Secondary Keywords):** When gathering related terms, pull from each subject's keyword profile in addition to the comparison keyword's related terms.

**Ahrefs budget:** +1 `keywords-explorer-overview` call per subject (~25-50 extra units per subject).

### Step 3: Find Secondary Keywords

Call `keywords-explorer-related-terms` with `terms: "also_rank_for"`.

These are keyword variations and synonyms that top-ranking pages also rank for. They become secondary keyword targets.

**Required fields:** `keyword,volume,difficulty,traffic_potential`

**Filtering:** Set `limit: 30` and use `where` to filter for viable keywords:

```json
{
  "and": [
    { "field": "volume", "is": ["gte", 100] },
    { "field": "difficulty", "is": ["lte", 60] }
  ]
}
```

Order by `traffic_potential:desc` to surface the highest-opportunity keywords first.

Select the top 3-5 secondary keywords based on:

- Relevance to the primary topic
- Traffic potential (prefer higher)
- Difficulty (prefer lower)

### Step 4: Find Semantic Keywords

Call `keywords-explorer-related-terms` with `terms: "also_talk_about"`.

These are LSI (Latent Semantic Indexing) keywords -- terms that top-ranking pages frequently mention. Including them signals topical depth to search engines.

**Required fields:** `keyword,volume`

Set `limit: 30`. No difficulty filter needed -- these are not ranking targets, they are terms to weave into the article body naturally.

Select 8-12 semantic keywords that are directly relevant to the topic.

### Step 5: Extract Question Keywords

Call `keywords-explorer-matching-terms` with `terms: "questions"`.

These question-form keywords become AEO-optimized H2/H3 headings directly. They match how people query both search engines and AI assistants.

**Required fields:** `keyword,volume,difficulty,traffic_potential`

Set `limit: 20` and filter for viable questions:

```json
{ "and": [{ "field": "volume", "is": ["gte", 50] }] }
```

Order by `volume:desc`.

Select 4-6 question keywords. Prefer questions that:

- Match the post type (e.g., "How to..." for tutorials, "What is..." for explainers)
- Have clear, answerable scope
- Appear in "People Also Ask" (cross-reference with SERP Analysis in Phase 3)

### Step 6: Find Long-Tail Variations

Call `keywords-explorer-matching-terms` with `terms: "all"` and `match_mode: "phrase"`.

Long-tail keywords are longer, more specific phrases with lower competition. They supplement the primary and secondary keywords.

**Required fields:** `keyword,volume,difficulty`

Set `limit: 20` and filter:

```json
{
  "and": [
    { "field": "volume", "is": ["gte", 50] },
    { "field": "word_count", "is": ["gte", 4] }
  ]
}
```

Select 3-5 long-tail keywords with the lowest difficulty scores.

For each long-tail candidate, check `parent_topic` from the Ahrefs response.
If the parent topic matches the primary keyword, the long tail is a **broad-topic
variation** (use as a subheading, not a separate page). If the parent topic differs,
it's a **topical long tail** -- note it as a separate post opportunity in the output.
See [long-tail-keyword-buckets.md](./references/long-tail-keyword-buckets.md).

### Step 7: Merge Seed Keywords and Assess Strategy

**If seed keywords exist (from Step 0.5):**

1. Merge seed keywords with Ahrefs-discovered keywords from Steps 2-6
2. De-duplicate by exact keyword match -- seed version wins (retains `source: seed` tag)
3. Seed keywords without Ahrefs metrics are included but marked `source: seed, scored: false`
4. Note in output: "Merged N seed keywords with M Ahrefs keywords (D duplicates removed)"

**Then assess overall keyword strategy (seed or no seed):**

Review all collected keywords and make final decisions:

1. **Primary keyword confirmed?** If `parent_topic` suggests a broader target, recommend switching
2. **Secondary coverage sufficient?** At least 3 secondary keywords with combined traffic_potential > 2x primary volume
3. **Question keywords usable as headings?** Each should fit naturally as an H2/H3
4. **Semantic keywords diverse?** Cover multiple subtopics, not just synonyms of the primary

### Step 7.5: Score Business Potential

For each keyword in the final set (primary + secondary + long-tail), assign a
business potential score based on how naturally Builder.io fits the topic.
Load the builder-product-knowledge skill for context.

| Score | Criteria                                                          | Action                                                               |
| ----- | ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| **3** | Builder.io is an irreplaceable solution to the searcher's problem | Keyword becomes a primary or prominent secondary target              |
| **2** | Builder.io helps significantly but alternatives exist             | Keyword is a valid secondary target; natural product mention         |
| **1** | Builder.io can only be mentioned in passing                       | Keyword is fine for topical coverage; do not force product placement |
| **0** | No natural way to mention Builder.io                              | Drop the keyword unless it serves a pure awareness goal              |

**Rules:**

- Score the _primary_ keyword first. If it scores 0, flag this to the user --
  a 0-score primary keyword means the topic may not justify the pipeline effort.
- Drop all 0-score secondary and long-tail keywords unless `content_goal: awareness`.
  For awareness posts, 0-score keywords are acceptable (the goal is reach, not product
  placement).
- Do not inflate scores. A 1 is fine. Forced product mentions hurt reader trust.
- When `content_goal: acquisition`, at least 2 keywords should score 2+.
  If not, warn the user that acquisition framing will feel forced.

## Output Schema

Write `phases/02-keyword-research.yaml`:

```yaml
keywords:
  primary: "react server components"
  primary_volume: 12000
  primary_difficulty: 45
  primary_traffic_potential: 28000
  primary_intent: informational
  primary_business_potential: 1
  parent_topic: "react server components"
  parent_topic_volume: 12000
  secondary:
    - keyword: "react server components tutorial"
      volume: 3200
      difficulty: 38
      traffic_potential: 15000
      business_potential: 1
    - keyword: "visual CMS for React"
      volume: 1200
      difficulty: 22
      traffic_potential: 4800
      business_potential: 3
  long_tail:
    - keyword: "how to use react server components in next.js"
      business_potential: 1
      bucket: broad_topic
    - keyword: "react server components vs client components difference"
      business_potential: 1
      bucket: broad_topic
    - keyword: "react server components error handling patterns"
      business_potential: 2
      bucket: topical
  separate_post_opportunities:
    - keyword: "react server components error handling patterns"
      volume: 120
      difficulty: 15
      note: "Topical long tail -- different parent topic. Hub cluster candidate."
  question_keywords:
    - "what are react server components"
    - "how do react server components work"
    - "when should you use server components"
    - "what is the difference between server and client components"
  semantic_keywords:
    - "server side rendering"
    - "streaming ssr"
    - "react suspense"
    - "hydration"
    - "bundle size"
    - "use client directive"
    - "async components"
    - "server actions"
  # Only when post_type == "comparison":
  comparison_subject_profiles:
    - subject: "Claude Code"
      volume: 8100
      difficulty: 22
      traffic_potential: 18000
      parent_topic: "claude code"
      unique_keywords:
        ["claude code mcp", "claude code terminal", "agentic coding cli"]
    - subject: "Cursor"
      volume: 33000
      difficulty: 35
      traffic_potential: 45000
      parent_topic: "cursor ai"
      unique_keywords:
        ["cursor composer", "cursor ai review", "cursor tab completion"]
data_source: ahrefs | estimated | social_signals
data_quality:
  api_available: true
  units_used: 280
  fallback_used: false
  notes: ""
# Seed keyword merge data (only when seed keywords present)
seed_keywords_merged: 0 # count of seed keywords added
seed_keywords_with_metrics: 0 # seed keywords with Ahrefs data
seed_keywords_unscored: 0 # seed keywords without Ahrefs data
seed_duplicates_removed: 0 # keywords in both seed and Ahrefs (seed kept)
```

## Trending Topic Mode

When `content_timing: trending` in Phase 1 output, Ahrefs data does not exist yet. Use social signals instead.

### Process

1. **Skip** all Ahrefs keyword research calls (no data exists for just-announced topics)
2. **Use WebSearch and WebFetch** to discover how people are discussing the topic:
   - WebSearch `site:x.com [topic]` for X/Twitter tweet snippets
   - WebFetch `https://hn.algolia.com/api/v1/search?query=[topic]&tags=story` for Hacker News threads (full access, free API)
   - WebSearch `[topic] reddit discussion` for indirect Reddit signal (direct Reddit access is blocked)
3. **Extract keywords from social discussion:**
   - Common phrases people use when discussing the announcement
   - Questions people are asking in comments
   - Related terms and comparisons ("X vs Y", "how does X compare to Z")
   - The exact language people use (becomes heading and title material)
4. **Write output** with `data_source: social_signals` and zero for all numeric Ahrefs fields
5. **Post-publish follow-up:** 2-4 weeks after publishing, run `/content-compound` to validate keywords retroactively once Ahrefs data populates

### Trending Output Differences

- `primary_volume`, `primary_difficulty`, `primary_traffic_potential`: set to `0`
- `data_source`: `social_signals`
- `question_keywords`: extracted from social discussion (what people are asking)
- `semantic_keywords`: extracted from social discussion (related terms people mention)
- `secondary` keywords: based on social phrase frequency, not Ahrefs data
- `business_potential`: still scored (does not depend on Ahrefs data -- uses builder-product-knowledge skill only)

## Fallback Behavior

If Ahrefs MCP is unavailable:

1. Wait 2 seconds, retry once
2. If retry fails, check `subscription-info-limits-and-usage` to determine if units are exhausted
3. Switch to WebSearch for approximate keyword data:
   - Search `"[keyword] search volume"` to find estimated volume
   - Search `"[keyword] keyword difficulty"` for competition estimates
   - Use Google autocomplete suggestions (via WebSearch) for secondary/long-tail keywords
4. Mark all metrics with `data_source: estimated`
5. Log the failure in `data_quality.notes`

Estimated data is acceptable for proceeding but should be noted in the final metadata for accuracy tracking.

## Examples

### Example: Primary Keyword with Parent Topic Redirect

**Input keyword:** "rsc next.js"

**`keywords-explorer-overview` returns:**

- volume: 1,800 | difficulty: 32 | traffic_potential: 28,000
- parent_topic: "react server components" (different from input)
- parent_volume: 12,000

**Decision:** Switch primary keyword to "react server components" -- the parent topic has 6x the volume and ranking for it will capture "rsc next.js" traffic too.

### Example: High-Difficulty Keyword with Long-Tail Pivot

**Input keyword:** "javascript frameworks"

**`keywords-explorer-overview` returns:**

- volume: 45,000 | difficulty: 82 | traffic_potential: 120,000

**Decision:** Too competitive (difficulty 82, no weak players in top 10). Pivot to long-tail: "best javascript frameworks for beginners 2026" (difficulty 28, volume 2,400). Report this as a recommended pivot back to Topic Discovery.

## Guidelines

- Always call `subscription-info-limits-and-usage` before starting. A full blog post workflow uses approximately 1,800-2,000 Ahrefs API units total.
- Set `limit: 20-50` on all calls. The default of 1000 is wasteful for content workflows.
- Use `country: "us"` as the default. Adjust only if the content targets a specific non-US audience.
- `traffic_potential` is the primary decision metric, not `volume`. A keyword with volume 500 may have traffic potential of 6,200.
- Do not over-optimize for keyword density. The keywords inform topic coverage and heading structure, not word stuffing.
- See [ahrefs-tool-mapping.md](./references/ahrefs-tool-mapping.md) for complete Ahrefs tool parameters and example calls.
- See [long-tail-keyword-buckets.md](./references/long-tail-keyword-buckets.md) for guidance on distinguishing broad-topic vs. topical long tails and how each type should be handled in the pipeline.
