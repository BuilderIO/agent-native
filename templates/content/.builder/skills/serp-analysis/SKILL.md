---
name: serp-analysis
description: "This skill should be used when analyzing search engine results pages for a target keyword. It covers SERP intent classification, AI Overview and featured snippet detection, content format analysis, competitive gap identification, beatability scoring, and People Also Ask extraction using the Ahrefs MCP server."
---

# SERP Analysis

Analyze the top 10 search results for a target keyword to understand what's ranking, why, and where the gaps are. The output feeds Content Research (Phase 4), Outline Creation (Phase 5), SEO Optimization (Phase 8), and AEO Optimization (Phase 9).

## When to Use This Skill

- After Keyword Research (Phase 2) has produced validated keywords with `data_source: ahrefs`
- When re-evaluating competitive landscape for an existing post during content refresh

## Prerequisites

- Keywords validated in `phases/02-keyword-research.yaml`
- Ahrefs MCP server available (check with `subscription-info-limits-and-usage` first)
- Primary keyword confirmed (use `primary` from keyword research output)

## Process

### Step 0: Check Content Timing

Read `content_timing` from `phases/01-topic-validation.yaml`.

**If `content_timing: trending`:** Skip this phase entirely. No SERP exists for just-announced topics. Write a minimal `phases/03-serp-analysis.yaml` with `skipped: true` and exit. See the Trending Topic Mode section below.

**If `content_timing: evergreen`:** Continue with Step 1.

### Step 1: Get SERP Results

Call `serp-overview` with the primary keyword from Phase 2.

**Required fields:** `keyword,position,title,url,domain_rating,url_rating,traffic,refdomains,backlinks,page_type`

**Call `mcp__claude_ai_ahrefs__doc` with `tool: "serp-overview"` first** to verify the current schema before making the call.

```json
{
  "select": "keyword,position,title,url,domain_rating,url_rating,traffic,refdomains,backlinks,page_type",
  "country": "us",
  "keywords": "<primary keyword>",
  "limit": 10
}
```

Record all 10 results. Each result provides the foundation for Steps 2-6.

### Step 1.5: Individual Subject SERP Analysis (Comparison Posts Only)

**Only when `post_type == "comparison"` in `phases/01-topic-validation.yaml`.**

Read `comparison_subjects` from Phase 1 output. For each subject, run a separate `serp-overview` call to understand how each product is positioned in search independently.

For each subject in `comparison_subjects`:

1. Call `serp-overview` with the individual subject name (use disambiguator if available from `comparison_disambiguators`)
2. Record: top 10 results with same fields as Step 1
3. Run Steps 2-6 on each individual SERP (intent, snippets, formats, beatability, PAA)

**Why this matters:** The comparison SERP ("Claude Code vs Cursor") shows what comparison posts look like. The individual SERPs ("Claude Code", "Cursor") reveal:

- How each product is positioned by its own community (tutorials? reviews? docs?)
- What content formats dominate for each product individually
- What questions people ask about each product separately (PAA from individual SERPs become subheading candidates)
- Which product has weaker competition (opportunity to go deeper on that angle)
- Keyword gaps where one product ranks but the comparison keyword doesn't

**Ahrefs budget:** +1 `serp-overview` call per subject (~50-100 extra units per subject).

Store individual SERP data in the output YAML under `comparison_subject_serps`.

### Step 1.7: Check for Seed SERP Intents

Check if `seed/serp-intents.txt` exists in the post output folder and is not empty (contains more than comments and blank lines).

**If `seed/serp-intents.txt` is present and non-empty:**

1. Read the file contents. The format is groups separated by blank lines, each group containing:
   - Intent group name (plain text line)
   - Description (what users in this group are looking for)
   - Percentage (line ending with `%`)
   - URL entries: title, URL, SERP position (repeating triplets)
2. Parse each intent group into structured data
3. Set `seed_serp_intents: true` in Phase 3 output
4. Store all groups in the `intent_clusters` output field
5. In Step 2 below, use these clusters as the **primary** intent source — skip LLM-inferred classification

**If `seed/serp-intents.txt` is absent or empty:** Set `seed_serp_intents: false` and proceed to Step 2 with standard LLM inference.

### Step 2: Classify Search Intent

**If `seed_serp_intents: true`:** Map the dominant intent cluster (highest percentage) to the standard intent categories. Use the cluster name and description to determine whether the intent is informational, navigational, commercial, or transactional. Store the full `intent_clusters` in the output YAML — downstream phases get both the standard classification and the rich cluster data. Skip the LLM inference below.

**If `seed_serp_intents: false` (default):** Determine the dominant search intent from the SERP results. Look at the content types and titles across all 10 results:

| Intent            | Signals from SERP                                            |
| ----------------- | ------------------------------------------------------------ |
| **informational** | "What is", "How to", "Guide", tutorials, explainers dominate |
| **navigational**  | Brand names, official docs, product pages dominate           |
| **commercial**    | "Best", "vs", "review", comparison pages dominate            |
| **transactional** | Pricing pages, "buy", "download", signup pages dominate      |

If the SERP shows mixed intent (e.g., half tutorials, half comparisons), classify as the majority and note the split. Mixed intent SERPs are harder to rank for -- consider narrowing the angle.

Cross-reference with `primary_intent` from `phases/02-keyword-research.yaml`. If they conflict, the SERP-derived intent takes precedence (it reflects what Google actually rewards).

#### Step 2b: Detect Fractured (Mixed) Intent

When no single intent dominates (< 6 of 10 results share the same intent),
the SERP has **fractured intent**. Handle as follows:

1. **Identify the dominant interpretation** -- the intent category with the most
   results (even if only 4-5 of 10). This is what to target.
2. **Identify the secondary interpretation** -- the second-most-frequent intent.
   Note it as a secondary angle opportunity.
3. **Classify the fracture type:**

   | Fracture Type     | Signal                                                             | Example                                                      |
   | ----------------- | ------------------------------------------------------------------ | ------------------------------------------------------------ |
   | **intent split**  | Same topic, different goals (some want to learn, some want to buy) | "docker" -- tutorials + download page + docs                 |
   | **meaning split** | Ambiguous term with multiple interpretations                       | "react native" -- the framework vs. native React features    |
   | **format split**  | Same intent, Google testing different formats                      | "API testing" -- tutorials + tools + comparisons all ranking |

4. **Assess SERP stability:**
   - Check if the top 10 results show a consistent set of domains (stable)
     or if positions fluctuate (volatile). The `url_rating` and `refdomains`
     spread gives a signal -- if metrics are tightly clustered, the SERP is
     stable; if they vary widely, it's volatile.
   - **Stable fractured SERP:** harder to break in but predictable once you rank.
   - **Volatile fractured SERP:** easier to break in but ranking may fluctuate.

5. **Strategy recommendation:**
   - Target the **dominant interpretation** with content that clearly serves
     that intent.
   - If the dominant interpretation is only slightly ahead (e.g., 4 vs. 3),
     consider whether the post can serve both intents without compromising
     either. If not, pick one.
   - Note the fracture in the output so downstream phases can adjust:
     - Outline creation: may need a broader scope to capture both intents
     - SEO optimization: title tag should signal the chosen intent clearly

### Step 3: Detect AI Overview and Featured Snippets

Examine the `serp-overview` response for SERP features:

**AI Overview detection:**

- Check the response `type` array or SERP features for `ai_overview` presence
- If AI Overview is present: organic CTR for positions 1-5 drops significantly. Flag this for Phase 9 -- AEO optimization becomes critical. Note in output: `has_ai_overview: true`

**Featured Snippet detection:**

- Check for `featured_snippet` in SERP features
- If present, identify the type:
  - **definition**: Paragraph answering "What is X?" (target with a concise 40-60 word definition)
  - **list**: Numbered or bulleted list (target with clear step-by-step or list format)
  - **table**: Data comparison (target with a comparison table)
- Record `has_featured_snippet: true` and `featured_snippet_type`

**Strategic decision:** If AI Overview is present AND no featured snippet exists, prioritize AEO over traditional SEO positioning. If both are present, optimize for both (answer-first content serves both).

### Step 4: Analyze Content Formats

For each of the top 10 results, classify the content format using the `page_type` field:

| Format         | Identifies As                                            |
| -------------- | -------------------------------------------------------- |
| **tutorial**   | Step-by-step guide, "How to", implementation walkthrough |
| **comparison** | "vs", "best X for Y", pros/cons format                   |
| **explainer**  | "What is", conceptual deep dive, architecture overview   |
| **listicle**   | "N ways to", "top N", numbered list format               |
| **reference**  | Documentation, API reference, specification              |
| **opinion**    | Thought leadership, prediction, hot take                 |

Count the format distribution. The dominant format (3+ of 10) is what Google rewards for this query.

**Decision rule:** Match the dominant format. If 7/10 results are tutorials, write a tutorial. Do not fight the SERP format -- differentiate through depth, recency, and unique insights, not format.

If no clear dominant format exists (even split), default to the `post_type` from Phase 1 topic validation.

### Step 5: Score Beatability

For each of the top 10 SERP positions, assess whether Builder.io's blog could realistically outrank it.

**Per-position scoring:**

| Factor          | Beatable Signal        | Strong Signal         |
| --------------- | ---------------------- | --------------------- |
| `domain_rating` | DR < 50                | DR < 30               |
| `url_rating`    | UR < 30                | UR < 15               |
| `refdomains`    | < 20 referring domains | < 5 referring domains |
| `backlinks`     | < 50 backlinks         | < 10 backlinks        |

Mark each position as:

- **beatable**: 3+ of 4 factors show beatable signals
- **challenging**: 1-2 factors show beatable signals
- **strong**: 0 factors show beatable signals

**Overall keyword beatability:**

| Condition                             | Classification                                                        |
| ------------------------------------- | --------------------------------------------------------------------- |
| 3+ positions in top 10 are "beatable" | **Beatable** -- proceed with confidence                               |
| 1-2 positions are "beatable"          | **Challenging** -- proceed but set realistic expectations             |
| 0 positions are "beatable"            | **Difficult** -- consider long-tail pivot or differentiation strategy |

If "Difficult", suggest revisiting keyword selection. A long-tail variation from Phase 2 may have weaker competition.

### Step 6: Extract People Also Ask

The `serp-overview` response may include "People Also Ask" (PAA) questions. Extract all available PAA questions.

If PAA is not available from the Ahrefs response, supplement with:

1. `question_keywords` from `phases/02-keyword-research.yaml` (already extracted in Phase 2)
2. A WebSearch for `"<primary keyword>"` and note the PAA box in Google results

PAA questions serve two purposes:

- **Outline headings:** Direct candidates for H2/H3 question-based headings (AEO optimization)
- **FAQ section:** Can populate a FAQ schema section at the end of the post

Select 4-8 PAA questions. Prefer questions that:

- Have clear, answerable scope (not too broad)
- Complement the primary topic angle
- Do not duplicate question keywords already captured in Phase 2

### Step 7: Run Competitive Gap Analysis

Identify what competing content covers and where they fall short.

**Step 7a: Identify competing domains**

Call `site-explorer-organic-competitors` with Builder.io as the target:

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

Record the top 3-5 competing domains by `common_keywords`.

**Step 7b: Analyze competitor keyword coverage**

For the top 3 competitors from the SERP results (by position), call `site-explorer-organic-keywords` to see what else they rank for in this topic area:

```json
{
  "select": "keyword,position,volume,traffic,difficulty",
  "target": "<competitor URL or domain>",
  "target_mode": "prefix",
  "country": "us",
  "limit": 20,
  "order_by": "traffic:desc"
}
```

Look for keywords the competitors rank for that are NOT in Phase 2's keyword list. These are coverage gaps -- topics the competitors address that the planned post could also cover.

**Step 7c: Discover competitor top content**

For the top 2-3 competing domains, call `site-explorer-top-pages` to find their highest-traffic content in the topic area:

```json
{
  "select": "url,traffic,keywords,top_keyword",
  "target": "<competitor domain>",
  "target_mode": "domain",
  "country": "us",
  "limit": 10,
  "order_by": "traffic:desc"
}
```

Identify their highest-performing pages. Note the angles, formats, and topic coverage they use.

**Step 7d: Cross-reference with semantic keywords**

Compare competitor keyword coverage against the `semantic_keywords` (also_talk_about) from Phase 2. Any semantic keyword that competitors address but the planned outline doesn't cover is a content gap to fill.

### Step 8: Identify Content Gaps

Synthesize all findings from Steps 1-7 into actionable content gaps:

1. **Topic gaps:** Subtopics no existing article covers well
2. **Depth gaps:** Topics covered superficially that deserve deep treatment
3. **Recency gaps:** Outdated information in top results (check publication dates)
4. **Format gaps:** No good tutorial exists, only reference docs (or vice versa)
5. **Perspective gaps:** All results are generic -- no opinionated or experience-based content

Each gap is a differentiation opportunity. The more gaps identified, the stronger the case for the planned post.

## Output Schema

Write `phases/03-serp-analysis.yaml`:

```yaml
skipped: false
seed_serp_intents: false # true when seed/serp-intents.txt was ingested
search_intent: informational | navigational | commercial | transactional
search_intent_confidence: high | medium | low # low when fractured
intent_fractured: true | false
intent_fracture_type: intent_split | meaning_split | format_split | null
intent_dominant_pct: 60 # percentage of top 10 matching dominant intent
intent_secondary: commercial | null # the runner-up intent (null if not fractured)
intent_secondary_pct: 30 # null if not fractured
serp_stability: stable | volatile
# When seed_serp_intents is true, also include:
# intent_clusters:
#   - name: "Understanding Claude Code"
#     description: "Users are seeking an overview or detailed understanding..."
#     percentage: 57
#     urls:
#       - position: 1
#         title: "Claude Code overview - Claude Code Docs"
#         url: "https://code.claude.com/docs/en/overview"
#   - name: "Official Claude Resources"
#     description: "Users are searching for official resources..."
#     percentage: 20
#     urls:
#       - position: 2
#         title: "Claude"
#         url: "https://claude.ai/"
has_ai_overview: true | false
has_featured_snippet: true | false
featured_snippet_type: definition | list | table | none
dominant_content_format: tutorial | comparison | explainer | listicle | reference | opinion
format_distribution:
  tutorial: 4
  explainer: 3
  comparison: 2
  listicle: 1
beatability: beatable | challenging | difficult
beatable_positions: 4 # count of "beatable" positions in top 10
top_results:
  - position: 1
    title: "..."
    url: "..."
    domain_rating: 78
    url_rating: 45
    traffic: 12500
    refdomains: 89
    backlinks: 234
    content_format: tutorial
    beatable: false
  - position: 2
    title: "..."
    url: "..."
    domain_rating: 42
    url_rating: 18
    traffic: 3200
    refdomains: 12
    backlinks: 28
    content_format: tutorial
    beatable: true
content_gaps:
  - "No existing article covers X"
  - "Most articles miss Y"
  - "Top results are outdated (published 2023)"
people_also_ask:
  - "Question 1?"
  - "Question 2?"
competitors:
  - domain: "competitor.com"
    common_keywords: 45
    traffic: 125000
    top_content_angle: "focuses on beginner tutorials"
  - domain: "another.com"
    common_keywords: 32
    traffic: 89000
    top_content_angle: "heavy on comparisons"
# Only when post_type == "comparison":
comparison_subject_serps:
  - subject: "Claude Code"
    search_intent: informational
    dominant_content_format: tutorial
    beatability: beatable
    beatable_positions: 5
    has_ai_overview: false
    people_also_ask:
      - "What is Claude Code?"
      - "How does Claude Code work?"
    content_gaps:
      - "No deep dive on MCP integration"
    unique_angles: "Most results focus on getting started, few cover advanced agentic workflows"
  - subject: "Cursor"
    search_intent: commercial
    dominant_content_format: comparison
    beatability: challenging
    beatable_positions: 2
    has_ai_overview: true
    people_also_ask:
      - "Is Cursor worth it?"
      - "What AI model does Cursor use?"
    content_gaps:
      - "No honest review of Composer limitations"
    unique_angles: "Many generic reviews, few cover workflow philosophy differences"
data_quality:
  api_available: true
  units_used: 0 # estimated after all calls
  notes: ""
```

Also append a narrative analysis to `research-notes.md`:

```markdown
## SERP Analysis

### Search Intent: [intent]

[Brief justification for the classification]

### Fractured Intent: [Yes/No]

[Only include this section when `intent_fractured: true`]

- Fracture type: [intent_split / meaning_split / format_split]
- Dominant: [intent] ([X]% of top 10)
- Secondary: [intent] ([Y]% of top 10)
- SERP stability: [stable / volatile]
- Strategy: Target [dominant intent]. [Note about secondary angle if applicable.]

### AI Overview Present: Yes/No

[If yes: "Organic CTR is significantly reduced. AEO optimization (Phase 9) is critical for this keyword."]
[If no: "Standard organic positioning strategy applies."]

### Featured Snippet Opportunity

[Type: definition/list/table/none. If present, note the target format for the answer-first section.]

### Dominant Content Format: [format]

[Distribution breakdown. Recommendation: match or differentiate?]

### Beatability: [beatable/challenging/difficult]

[Summary: X of 10 positions are beatable. Key weak spots at positions N, N.]

### Top Results Analysis

1. [Title](url) - DR: X | Format: Y | Beatable: yes/no
2. ...
   (all 10 positions)

### Content Gaps

- Gap 1: ...
- Gap 2: ...

### People Also Ask

- Question 1?
- Question 2?

### Competitive Landscape

[Top competing domains, their strengths, and where they are beatable]

### Recommended Strategy

[1-2 sentences: Based on SERP analysis, recommend the approach -- format, angle, differentiation strategy]
```

## Trending Topic Mode

When `content_timing: trending` in Phase 1 output, no SERP exists yet. This phase produces a stub and exits.

### Process

1. Read `content_timing` from `phases/01-topic-validation.yaml`
2. If `trending`, write the stub output below and stop
3. Do NOT make any Ahrefs SERP calls -- there is no data to retrieve

### Trending Output

Write `phases/03-serp-analysis.yaml`:

```yaml
skipped: true
skip_reason: "trending topic -- no SERP data available"
search_intent: null
has_ai_overview: null
has_featured_snippet: null
content_gaps: []
people_also_ask: []
competitors: []
data_quality:
  api_available: true
  units_used: 0
  notes: "Phase skipped: content_timing is trending. Re-run after 2-4 weeks via /content-compound."
```

Append to `research-notes.md`:

```markdown
## SERP Analysis

**Skipped:** This is a trending topic (`content_timing: trending`). No established SERP exists yet.

Downstream phases will use social-signal-derived data from Phase 2 in place of SERP data. Schedule a `/content-compound` pass in 2-4 weeks to retroactively run SERP analysis once search data populates.
```

## Examples

### Example 1: Beatable Informational SERP

**Primary keyword:** "react server components tutorial"

**SERP findings:**

- Search intent: `informational` (9/10 results are tutorials)
- AI Overview: `false`
- Featured snippet: `list` (step-by-step snippet from position 1)
- Dominant format: `tutorial` (9 of 10)
- Beatability: `beatable` (4 positions have DR < 50, < 15 referring domains)
- Content gaps: "No tutorial covers RSC with the App Router in Next.js 15", "Most tutorials are from 2024, pre-stable RSC"

**Strategy:** Write a tutorial matching the dominant format. Differentiate through recency (Next.js 15 + stable RSC) and depth (cover data fetching patterns competitors skip). Target the list featured snippet with clear numbered steps.

### Example 2: Competitive SERP with AI Overview

**Primary keyword:** "javascript frameworks comparison 2026"

**SERP findings:**

- Search intent: `commercial` (7/10 are comparison pages)
- AI Overview: `true` (Google AI synthesizes a comparison table)
- Featured snippet: `table` (comparison table at position 0)
- Dominant format: `comparison` (7 of 10)
- Beatability: `difficult` (0 positions have DR < 50)
- Content gaps: "No comparison includes Builder.io's Qwik framework perspective"

**Strategy:** AI Overview presence means organic CTR is reduced. Prioritize AEO optimization so AI assistants cite this comparison. Differentiate through a Qwik perspective that no competitor covers. Consider pivoting to a less competitive long-tail: "best javascript frameworks for enterprise apps 2026."

### Example 3: Trending Topic Skip

**Primary keyword:** "claude 4.5 tutorial"

**Content timing:** `trending`

**Action:** Phase skipped entirely. Wrote stub YAML with `skipped: true`. Downstream phases use social-signal keywords from Phase 2.

## Guidelines

- Always call `mcp__claude_ai_ahrefs__doc` before using a SERP tool for the first time. The schemas may change.
- Set `limit: 10` for `serp-overview`. The top 10 is sufficient for SERP analysis -- positions 11+ add noise.
- Use `country: "us"` as the default. Adjust only if the content targets a specific non-US audience.
- Do not over-index on beatability. A "difficult" SERP is still worth targeting if the content gaps are large and the topic is strategically important.
- The dominant content format is a strong signal, not an absolute rule. If all 10 results are mediocre tutorials and the topic would be better served by a comparison, note this as a differentiation opportunity.
- Content gaps are the most actionable output of this phase. Each gap becomes a section or angle in the outline.
- See [ahrefs-tool-mapping.md](../keyword-research/references/ahrefs-tool-mapping.md) for complete Ahrefs tool parameters and example calls.
