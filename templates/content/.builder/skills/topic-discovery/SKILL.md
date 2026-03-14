---
name: topic-discovery
description: "This skill should be used when evaluating whether a topic is worth writing about for Builder.io. It covers awareness vs. acquisition classification, trend signal analysis from X and Hacker News, keyword volume validation via Ahrefs, Builder.io relevance assessment, post-type classification, and content pillar alignment."
---

# Topic Discovery

Evaluate a proposed blog topic and produce a go/no-go recommendation with structured output. The output of this phase feeds every downstream phase -- content goal, post type, and Builder.io relevance all cascade through the pipeline.

## When to Use This Skill

- A topic has been proposed for a new blog post
- Deciding between multiple candidate topics
- Validating whether a trending topic is worth pursuing

## Process

### Step 0: Detect Hub Context

Check whether this topic evaluation is happening within a content hub pipeline.

**If `hub_slug` is provided** (from `hub-context.yaml` auto-detection or pre-populated Phase 1 artifact):

1. Read `output/hubs/<hub_slug>/hub.yaml` to load the hub definition
2. Identify the page being created (pillar or a specific cluster slug from `hub.yaml`)
3. Set `page_type` based on context:
   - `pillar` — creating the hub's pillar page
   - `cluster` — creating a specific cluster page within the hub
4. Collect all planned keywords from `hub.yaml` (pillar `primary_keyword` + all cluster `primary_keyword` values) for cannibalization checking in Step 6

**If `hub_slug` is not provided:** Set `page_type: standalone`. Continue normally — this is a regular blog post.

The `page_type` field is orthogonal to `post_type` (tutorial, comparison, etc.). `page_type` drives page structure and linking behavior; `post_type` drives the content template.

### Step 0.5: Check for Seed Data

Before any evaluation, check for a `seed/` subfolder in the post output folder.

**If `seed/` exists:** Load the Seed Research skill. Run Steps 1-4 (detect, inventory, validate, build summary). Report the seed summary to the user: "Detected seed folder: N URLs, N keywords, N articles, notes: yes/no". Pass `seed_detected: true` and `seed_summary` to the output YAML.

Seed content provides context for classification but does not override any decisions. The content goal, timing, and all other classifications are still determined independently. Seed informs but does not automate.

**If `seed/` does not exist:** Set `seed_detected: false` in the output YAML. Continue with Step 1 as normal.

### Step 1: Classify the Content Goal

Determine the primary purpose of the post:

| Goal            | Definition                                                                                      | Builder.io Role                 |
| --------------- | ----------------------------------------------------------------------------------------------- | ------------------------------- |
| **awareness**   | Genuinely helpful content on trending/high-demand topics. May have no connection to Builder.io. | None or tangential              |
| **acquisition** | Topics where Builder.io naturally solves the developer's problem. Product mention is organic.   | Central to the solution         |
| **hybrid**      | Primarily educational with a natural Builder.io connection at the end.                          | Light touch, end-of-article CTA |

Use these signals to classify:

- **awareness**: Topic is trending on X/Hacker News, high search volume, no obvious Builder.io angle
- **acquisition**: Topic directly involves visual development, design-to-code, CMS, or AI dev tools
- **hybrid**: Topic is educational (framework tutorial, architecture guide) where Builder.io fits as one tool in the solution

### Step 1.5: Classify Content Timing

Determine whether this is an evergreen or trending topic:

| Timing        | Signals                                                         | Example                     |
| ------------- | --------------------------------------------------------------- | --------------------------- |
| **evergreen** | Topic has existed for months/years, established search volume   | "What is a headless CMS"    |
| **trending**  | Announced in last 48 hours, no established SERP, time-sensitive | "Claude 4.5 launched today" |

**Detection signals for trending:**

- User explicitly says "just announced", "launched today", "breaking", "want to be first"
- Topic references a specific event or release within the last 48 hours
- WebSearch shows news results but no tutorial/blog content yet
- Ahrefs returns zero or near-zero volume for the topic

When `content_timing: trending`, the pipeline changes:

- Phase 2 (Keyword Research) uses social signals instead of Ahrefs
- Phase 3 (SERP Analysis) is skipped entirely (no SERP exists)
- Phase 4 (Content Research) uses narrow skip: still runs HN, X, YouTube, official docs; skips Ahrefs competitive data, LLM patterns, Stack Overflow
- Step 5 below (Search Demand) uses social validation instead of Ahrefs
- Step 7 below (Scoring) uses trending-specific criteria

### Step 2: Assess Builder.io Relevance

Rate the natural connection between the topic and Builder.io:

| Rating      | Meaning                                  | Example                                                               |
| ----------- | ---------------------------------------- | --------------------------------------------------------------------- |
| **natural** | Builder.io IS the tool for this topic    | "How to set up a visual CMS with Next.js"                             |
| **light**   | Builder.io fits as one option among many | "React state management patterns" (visual editor reduces state needs) |
| **none**    | No authentic connection exists           | "Rust async programming patterns"                                     |

If relevance is `none`, the content goal must be `awareness`. Do not force a Builder.io connection.

### Step 3: Classify the Post Type

Determine the best format based on the topic and likely search intent:

| Type                   | Best For                    | Signals                                           |
| ---------------------- | --------------------------- | ------------------------------------------------- |
| **tutorial**           | Step-by-step implementation | "How to", "getting started", "build a"            |
| **comparison**         | Evaluating alternatives     | "vs", "best", "which", "alternatives"             |
| **explainer**          | Conceptual understanding    | "What is", "why", "how does X work"               |
| **how-to**             | Achieving a specific goal   | "N ways to", "improve", "optimize"                |
| **thought-leadership** | Opinion or prediction       | Contrarian take, industry trend, emerging pattern |

The post type cascades to outline templates (Phase 5), headline formulas (Phase 6), and schema markup (Phase 8).

### Step 3.5: Extract Comparison Subjects

**Only when `post_type == "comparison"`.**

Parse the topic to extract the individual products, tools, or concepts being compared. Store as a list for downstream phases to research each subject individually.

**Extraction rules:**

- Split on "vs", "vs.", "versus", "or" (when used in "X or Y" comparison context)
- Trim whitespace and qualifiers like "in 2026", "for Enterprise"
- Keep product names intact ("Claude Code" stays as "Claude Code", not "Claude" + "Code")
- For 3-way comparisons ("Next.js vs Remix vs Astro"), extract all three subjects

**Examples:**

- "Claude Code vs Cursor" → `["Claude Code", "Cursor"]`
- "React vs Vue for Enterprise Apps" → `["React", "Vue"]`
- "Next.js vs Remix vs Astro" → `["Next.js", "Remix", "Astro"]`

**Add disambiguators** if a subject name is generic (common English word or has multiple meanings):

- "Cursor" → add `"cursor_disambiguator": "cursor ai code editor"` for platform searches
- "Builder" → add `"builder_disambiguator": "builder.io visual development"`

Store as `comparison_subjects` in the output YAML. Downstream phases (Keyword Research, SERP Analysis, Content Research) use this list to research each subject individually in addition to the merged comparison keyword.

### Step 4: Align to a Content Pillar

Every post should strengthen one of Builder.io's 4 content pillars:

| Pillar                    | Topics                                                                      |
| ------------------------- | --------------------------------------------------------------------------- |
| **visual-development**    | Visual CMS, design-to-code, component editing, Figma workflows              |
| **dev-marketer-collab**   | Content workflows, reducing Jira tickets for copy changes, team handoffs    |
| **framework-integration** | Next.js, React, Angular, Qwik, Nuxt, Vue, Svelte                            |
| **performance**           | Core Web Vitals, image optimization, bundle size, visual editor performance |

For pure awareness content with no pillar fit, use the pillar closest to the topic's audience. Framework tutorials default to `framework-integration`.

### Step 5: Validate Search Demand

**If `content_timing: trending`:** Skip Ahrefs validation entirely. Instead, validate demand through social signals:

1. WebSearch: Are people discussing this on X and Hacker News right now? (Note: Reddit is not directly accessible via WebSearch -- use HN as primary community signal)
2. Is this from a major player (Anthropic, Google, Meta, Vercel, etc.) whose announcements consistently generate traffic?
3. Is there a clear developer audience who needs to understand this?
4. Mark `data_source: social_signals` in the output. Set `search_volume`, `keyword_difficulty`, and `traffic_potential` to `0`.

**If `content_timing: evergreen`:** Use Ahrefs MCP to confirm the topic has search demand:

1. Call `keywords-explorer-overview` with the topic as keyword:
   - Check `volume` (monthly search volume)
   - Check `difficulty` (keyword difficulty score 0-100)
   - Check `traffic_potential` (total organic traffic the #1 page gets from all keywords)

2. Call `keywords-explorer-volume-history` to confirm the trend:
   - **Trending up**: Volume increasing over last 6-12 months -- strong signal
   - **Stable**: Consistent volume -- acceptable
   - **Declining**: Volume dropping -- reconsider unless the topic is evergreen

**Minimum thresholds (evergreen only):**

- `volume` >= 200 OR `traffic_potential` >= 1000
- If both are below threshold, the topic may still be viable if it fills a clear content gap or supports a strategic pillar

**Fallback:** If Ahrefs MCP is unavailable, use WebSearch to estimate demand: search `"[topic] search volume 2026"` and check Google Trends via WebFetch. Mark all metrics as `data_source: estimated`.

### Step 6: Check for Keyword Cannibalization

Before proceeding, verify no existing post already targets the same primary keyword.

**6a. Check published content (always runs):**

1. Search `output/posts/*/phases/02-keyword-research.yaml` for the proposed keyword
2. Search `output/posts/*/post.md` frontmatter for matching `primary_keyword`
3. Search `output/hubs/*/clusters/*/metadata.yaml` for matching `primary_keyword` (catches hub cluster pages even when not in hub mode)
4. Search `output/hubs/*/pillar/metadata.yaml` for matching `primary_keyword`
5. If a match exists, assess whether the new post would compete with or complement the existing one

**6b. Check hub siblings (only when `hub_slug` is set):**

When working within a hub, additionally check the proposed topic against ALL planned cluster keywords from `hub.yaml` — not just published ones:

1. Compare the proposed `primary_keyword` against every keyword in the hub plan (pillar + all clusters)
2. Skip the current page's own keyword (the page being created will obviously match itself)
3. If a keyword overlap is found, call `serp-overview` on both keywords and compare top-10 URLs
4. If > 3 shared URLs in the top-10 SERPs, flag as cannibalization — the two pages likely target the same search intent
5. If 1-3 shared URLs, note as a warning but allow — the topics are related but likely distinct enough

If cannibalization is detected:

- Suggest a differentiated angle (different post type, different audience segment)
- Or recommend updating the existing post instead of creating a new one
- In hub mode: recommend merging the overlapping cluster pages or adjusting keyword assignments in `hub.yaml`

### Step 7: Score Topic Priority

**For evergreen topics (`content_timing: evergreen`):**

| Criterion             | Weight | Score (1-5) | Question                                        |
| --------------------- | ------ | ----------- | ----------------------------------------------- |
| Search Demand         | 25%    |             | Are developers actively searching for this?     |
| Product Relevance     | 25%    |             | Does Builder.io naturally solve this problem?   |
| Competitive Gap       | 20%    |             | Is existing content weak, outdated, or missing? |
| Conversion Potential  | 15%    |             | Could this drive trials/signups?                |
| Topical Authority Fit | 15%    |             | Does it strengthen a content pillar?            |

**For trending topics (`content_timing: trending`):**

| Criterion         | Weight | Score (1-5) | Question                                                                           |
| ----------------- | ------ | ----------- | ---------------------------------------------------------------------------------- |
| Timeliness        | 30%    |             | How many hours until competitors publish? (5 = we'd be first, 1 = already covered) |
| Audience Match    | 25%    |             | Does our developer audience care about this announcement?                          |
| Product Relevance | 20%    |             | Does Builder.io naturally connect to this topic?                                   |
| Source Authority  | 15%    |             | Is this from a major player or verified source? (not rumors)                       |
| Content Depth     | 10%    |             | Can we add value beyond restating the announcement?                                |

**Weighted score** = sum of (score x weight) for each criterion.

- **4.0+**: Strong topic -- proceed
- **3.0-3.9**: Viable topic -- proceed with noted risks
- **2.0-2.9**: Weak topic -- suggest pivot
- **Below 2.0**: Reject -- not worth the investment

### Step 8: Produce Viability Recommendation

Based on all signals, classify as:

| Viability   | When                                                   | Action                     |
| ----------- | ------------------------------------------------------ | -------------------------- |
| **proceed** | Score >= 3.0, search demand exists, no cannibalization | Continue to Phase 2        |
| **pivot**   | Topic has potential but needs a different angle        | Provide `pivot_suggestion` |
| **reject**  | Score < 2.0 or no search demand and no strategic value | Stop with reasoning        |

## Output Schema

Write `phases/01-topic-validation.yaml` with this structure:

```yaml
topic: "React Server Components"
page_type: standalone | pillar | cluster # standalone for regular posts, pillar/cluster for hub pages
hub_slug: "" # empty for standalone, hub slug for hub pages
content_goal: awareness | acquisition | hybrid
content_timing: evergreen | trending
builder_io_relevance: natural | light | none
viability: proceed | pivot | reject
pivot_suggestion: "Consider X instead" # only if viability != proceed
post_type: tutorial | comparison | explainer | how-to | thought-leadership
comparison_subjects: ["Claude Code", "Cursor"] # only when post_type == "comparison"
comparison_disambiguators: # only when a subject name is generic
  Cursor: "cursor ai code editor"
content_pillar: visual-development | dev-marketer-collab | framework-integration | performance
priority_score: 4.2
priority_breakdown:
  # evergreen uses: search_demand, product_relevance, competitive_gap, conversion_potential, topical_authority_fit
  # trending uses: timeliness, audience_match, product_relevance, source_authority, content_depth
  search_demand: 5
  product_relevance: 3
  competitive_gap: 4
  conversion_potential: 4
  topical_authority_fit: 5
trend_direction: rising | stable | declining | new # "new" for trending topics with no history
search_volume: 12000 # 0 for trending topics
keyword_difficulty: 45 # 0 for trending topics
traffic_potential: 28000 # 0 for trending topics
data_source: ahrefs | estimated | social_signals
trending_context: "" # only for trending topics, e.g., "Announced by Anthropic on 2026-02-08"
cannibalization_check: clear | conflict_detected
cannibalization_note: "" # details if conflict detected
seed_detected: false # true if seed/ subfolder found
seed_summary: # only when seed_detected: true
  url_count: 0
  keyword_count: 0
  article_count: 0
  has_notes: false
  total_files: 0
  validation_warnings: []
  empty: false
```

## Examples

### Example 1: Strong Awareness Topic

**Input:** "React Server Components"

**Evaluation:**

- Content goal: `awareness` (trending React topic, no direct Builder.io angle)
- Builder.io relevance: `light` (Builder.io supports RSC via experimental SDK)
- Post type: `explainer` (developers want to understand what RSC is)
- Content pillar: `framework-integration`
- Search demand: volume 12,000, difficulty 45, trending up
- Priority score: 4.0 (high demand, moderate relevance, strong pillar fit)
- Viability: `proceed`

### Example 2: Strong Acquisition Topic

**Input:** "How to set up a visual CMS with Next.js"

**Evaluation:**

- Content goal: `acquisition` (Builder.io IS the tool for this)
- Builder.io relevance: `natural`
- Post type: `tutorial`
- Content pillar: `visual-development`
- Search demand: volume 2,400, difficulty 32, stable
- Priority score: 4.6 (strong demand, direct relevance, clear conversion path)
- Viability: `proceed`

### Example 3: Trending/Breaking Topic

**Input:** "Anthropic just launched Claude 4.5 -- I want to publish a tutorial tomorrow"

**Evaluation:**

- Content timing: `trending` (announced today, user wants speed)
- Content goal: `awareness` (no direct Builder.io angle)
- Builder.io relevance: `light` (Builder.io Fusion uses Anthropic models)
- Post type: `tutorial` (developers want to try the new model)
- Content pillar: `framework-integration` (closest fit)
- Search demand: social signals strong (trending #1 on Hacker News, 500+ X posts)
- Ahrefs data: skipped (zero volume exists yet)
- Priority score: 4.4 (timeliness: 5, audience: 5, relevance: 2, source: 5, depth: 4)
- Viability: `proceed`
- Trending context: "Announced by Anthropic on 2026-02-08, no existing tutorials yet"

**Pipeline impact:** Phase 3 (SERP Analysis) will be skipped. Phase 4 (Content Research) will focus on the announcement docs and social reaction.

### Example 4: Weak Topic -- Pivot

**Input:** "Rust async programming patterns"

**Evaluation:**

- Content goal: `awareness` (no Builder.io connection)
- Builder.io relevance: `none`
- Post type: `explainer`
- Content pillar: none (Rust is not a Builder.io-supported framework)
- Search demand: volume 800, difficulty 62, stable
- Priority score: 1.8 (no relevance, high difficulty, off-pillar)
- Viability: `reject`
- Reason: "Topic has no connection to Builder.io's content pillars and high keyword difficulty. Consider writing about a framework Builder.io supports (React, Next.js, Angular, Vue, Qwik)."

### Example 5: Hub Cluster Page

**Input:** "Claude Code vs Cursor" (within hub_slug: `claude-code`, page_type: `cluster`)

**Evaluation:**

- Hub context: detected `hub_slug: claude-code`, `page_type: cluster`
- Hub sibling keywords loaded from `hub.yaml`: "claude code", "how to use claude code", "claude code tips", etc.
- Content goal: `acquisition` (overridden per-cluster in `hub.yaml`)
- Builder.io relevance: `light`
- Post type: `comparison`
- Content pillar: `framework-integration`
- Search demand: volume 2,400, difficulty 28, trending up
- Cannibalization check (6a): no published posts match
- Cannibalization check (6b): SERP overlap with sibling "how to use claude code" = 1 shared URL (acceptable, distinct intent)
- Priority score: 4.2
- Viability: `proceed`

**Pipeline impact:** Downstream skills read `page_type: cluster` and `hub_slug` from this artifact. Outline-creation adds mandatory pillar backlink in intro. SEO-optimization uses hub link graph instead of WebSearch.

## Guidelines

- Never force a Builder.io connection where none exists. Awareness content earns trust; forced mentions erode it.
- `traffic_potential` is more valuable than `volume` alone. A keyword with volume 500 may have traffic potential of 6,200.
- Always check `parent_topic` from Ahrefs. If the parent topic differs from the keyword, consider targeting the parent instead.
- Declining trends are not automatic rejections. Evergreen topics (e.g., "what is a headless CMS") have stable long-term value.
- When in doubt about Builder.io relevance, classify as `awareness`. It is better to understate relevance than to force a connection.
- Topic validation is fast. Spend 5-10 minutes here, not 30. The goal is a go/no-go decision, not deep research.
