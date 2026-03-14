---
name: content-refresh-analysis
description: "This skill should be used when analyzing an existing blog post against current keyword and SERP data to determine what changed and recommend a refresh scope. It covers original post parsing, keyword delta analysis, SERP delta analysis, section-level KEEP/REWRITE/ADD recommendations, scope thresholds, and refresh-scope.yaml generation."
---

# Content Refresh Analysis

Compare an existing blog post against current keyword and SERP data to determine what changed in the competitive landscape. Produce a section-level action plan (KEEP/REWRITE/ADD) and recommend a refresh scope: metadata-only, selective-rewrite, or full-rewrite.

## When to Use This Skill

- After the `/content-refresh` orchestrator skill fetches fresh keyword and SERP data (Phases 1-2)
- When comparing an original post's structure against current competitive data
- During Phase 3 of the refresh pipeline (Delta Analysis)

## Prerequisites

- Original post content fetched and parsed in `phases/00-original-post-analysis.yaml`
- Fresh keyword data in `phases/01-refresh-keyword-research.yaml`
- Fresh SERP data in `phases/02-refresh-serp-analysis.yaml`
- Any seed materials in the `seed/` subfolder (new articles, keywords, notes)

## Process

### Step 0: Load Inputs

Read three data sources:

1. **Original post analysis** from `phases/00-original-post-analysis.yaml`:
   - Title, headings (H2/H3), section content summaries, word count
   - Content goal, content timing, target keywords
   - Whether the post was created by the content pipeline (has pipeline metadata)

2. **Fresh keyword data** from `phases/01-refresh-keyword-research.yaml`:
   - Current primary keyword metrics (volume, difficulty, position)
   - Secondary and semantic keywords
   - New keyword opportunities

3. **Fresh SERP data** from `phases/02-refresh-serp-analysis.yaml`:
   - Current top 10 results
   - AI Overview and featured snippet status
   - People Also Ask questions
   - Content gaps and competitive landscape

Also check for seed materials:
- `seed/keywords.txt` -- user-provided keywords to consider
- `seed/notes.md` -- user observations about what needs updating
- `seed/urls.txt` -- new reference articles
- Any additional `.md` files in `seed/`

### Step 1: Compare Keywords

Compare the original post's target keywords against fresh keyword data.

**Identify:**
- **Unchanged keywords:** Primary keyword still valid, volume stable
- **New high-volume keywords:** Keywords with significant volume (>500/mo) that did not exist or were not targeted in the original
- **Dropped keywords:** Keywords the original targeted that have lost relevance (volume dropped >50% or no longer match search intent)
- **Competitor keywords we miss:** Keywords that top-5 SERP competitors rank for that the original post does not address

**Ranking change assessment:**
- If Ahrefs position data is available for the original primary keyword, compare old rank vs current rank
- If Ahrefs data is unavailable, use WebSearch to estimate current position (search the primary keyword, check if the post appears in the first 5 pages)
- Record `positions_dropped` (0 = stable, positive = dropped, negative = improved)

### Step 2: Compare SERP Landscape

Compare what was true when the post was published against current SERP state.

**Identify:**
- **New competitors:** Domains in the top 5 that were not there before
- **Lost positions:** How many positions the original post dropped
- **New SERP features:** AI Overview now present (was not before), new PAA questions, featured snippet format changes
- **Intent shift:** Has the search intent changed? (e.g., was informational, now commercial)

For posts without original SERP data (external posts or trending-to-evergreen transitions), treat the current SERP as the baseline and skip the delta comparison. Note: `original_serp_data: unavailable` in the output.

### Step 3: Section-Level Analysis

For each H2 section in the original post, evaluate:

1. **Content accuracy:**
   - Do code examples reference current API versions?
   - Are technical claims still correct?
   - Have best practices changed since publication?

2. **Competitive depth:**
   - Do top-5 competitors cover this subtopic with more depth, examples, or data?
   - Has new authoritative content been published on this subtopic?

3. **Content gaps:**
   - Do competitors have sections the original post lacks?
   - Are there new PAA questions that suggest missing coverage?

4. **AEO quality:**
   - Is the section's answer-first block still quote-worthy?
   - Would an LLM cite this section as-is, or is it now outdated?

**Assign each section an action:**

| Action | Criteria |
|--------|----------|
| **KEEP** | Content is accurate, competitive depth is adequate, answer-first block is still quote-worthy |
| **REWRITE** | Content has inaccuracies, competitors cover it better, or answer-first block is outdated |
| **ADD** | Competitors cover a subtopic the original post lacks entirely. Specify `insert_after` position |

Include a `reason` for every REWRITE and ADD action. KEEP sections get a brief confirmation reason.

### Step 4: Check Seed Materials

If the `seed/` folder contains user-provided materials:

1. Read `seed/notes.md` for user observations about what needs updating
2. Read additional `.md` files for new reference content
3. Read `seed/keywords.txt` for user-provided keyword targets
4. Incorporate user signals into section analysis:
   - If user notes say "Section X is outdated," mark it REWRITE even if automated analysis says KEEP
   - If user provides new reference articles covering a topic, consider whether they suggest an ADD section
   - User seed signals are high-priority -- they override automated analysis when they conflict

### Step 5: Evaluate Content Goal and Timing Changes

Check whether the original content goal or timing should change:

**Content goal change:**
- If SERP intent shifted from informational to commercial: recommend `awareness` to `acquisition`
- If the post's topic now has a natural Builder.io connection that did not exist before: recommend `awareness` to `hybrid`
- If the Builder.io product mentioned is deprecated or significantly changed: flag for review

**Content timing change:**
- If the original was `trending` and SERP data now exists: recommend transition to `evergreen` (this means full SERP analysis is now possible)
- If the original was `evergreen` but the topic has become time-sensitive (new release, breaking change): note this but do not change timing (the refresh itself addresses recency)

Record recommendations as `content_goal_change` and `content_timing_change` in the output. The user decides at Gate 1.

### Step 6: Determine Refresh Scope

Apply the delta threshold matrix from [delta-thresholds.md](./references/delta-thresholds.md).

Evaluate each signal:

1. **Sections needing rewrite:** Count REWRITE sections / total sections
2. **New sections to add:** Count ADD sections
3. **SERP intent shift:** From Step 2
4. **Primary keyword ranking change:** From Step 1
5. **Framework/API version outdated:** From Step 3

The overall recommendation is the **highest triggered scope** across all signals.

**Scope definitions:**
- **metadata-only:** No content changes. Re-optimize meta description, title tag, keywords, schema markup, and internal links.
- **selective-rewrite:** Mark sections as KEEP/REWRITE/ADD. Preserve 50-80% of original content. Rewrite flagged sections and add new ones.
- **full-rewrite:** Essentially re-run the blog pipeline seeded with the original post. Preserve URL and slug but rewrite all content.

### Step 7: Generate refresh-scope.yaml

Write the complete refresh scope file to `refresh-scope.yaml` in the post output folder.

## Output Schema

Write `refresh-scope.yaml`:

```yaml
refresh_mode: selective-rewrite  # metadata-only | selective-rewrite | full-rewrite
recommendation_reason: "2 of 6 sections have outdated code examples. 1 new competitor section to add. Primary keyword dropped from #3 to #8."
scope_override: false  # true if user overrode at Gate 1
original_recommendation: null  # populated only if scope_override is true
original_post:
  url: "https://example.com/blog/topic"
  title: "Original Post Title"
  word_count: 2150
  publish_date: "2025-06-15"
  content_goal: awareness
  content_timing: evergreen
  sections_count: 6
  has_pipeline_metadata: true  # false for external posts
keyword_delta:
  original_primary: "react server components"
  current_primary: "react server components"
  positions_dropped: 5
  new_high_volume_keywords:
    - "rsc tutorial"
    - "server components next 15"
  dropped_keywords:
    - "react server side rendering"
  competitor_keywords_we_miss:
    - "rsc vs ssr"
    - "server components streaming"
serp_delta:
  original_serp_data: available  # available | unavailable
  new_competitors:
    - "vercel.com/blog/rsc-guide"
    - "tkdodo.eu/blog/rsc"
  lost_positions: 5
  new_serp_features:
    - type: ai_overview
      status: "now present, was not before"
    - type: paa
      new_questions:
        - "Are React Server Components production ready?"
        - "Do Server Components replace getServerSideProps?"
  intent_shift: none  # none | minor | major
sections:
  - heading: "Introduction"
    action: KEEP
    reason: "Hook and context still relevant"
  - heading: "What Are React Server Components?"
    action: KEEP
    reason: "Definition and explanation still accurate"
  - heading: "How Do Server Components Differ from Client Components?"
    action: REWRITE
    reason: "Missing streaming and Suspense integration added in Next.js 15"
  - heading: "How to Build Your First Server Component"
    action: REWRITE
    reason: "Code examples use Next.js 14 API, needs update to 15"
  - heading: "Server Components and Streaming"
    action: ADD
    insert_after: "How to Build Your First Server Component"
    reason: "3 of top 5 competitors cover streaming. Major content gap."
  - heading: "FAQ"
    action: REWRITE
    reason: "2 new PAA questions to add, 1 existing answer outdated"
  - heading: "Conclusion"
    action: KEEP
    reason: "CTA still relevant"
content_goal_change: none  # none | recommended (with details below)
content_goal_recommendation: null  # e.g., "awareness -> hybrid: Builder.io now has RSC visual editing"
content_timing_change: none  # none | recommended (with details below)
content_timing_recommendation: null  # e.g., "trending -> evergreen: SERP data now available"
seed_signals_applied:
  - "User noted Section 3 code examples are outdated (notes.md)"
  - "User provided new reference article on streaming (seed/streaming-guide.md)"
```

Also write `phases/03-delta-analysis.yaml` with summary metrics:

```yaml
refresh_mode: selective-rewrite
sections_total: 6
sections_keep: 3
sections_rewrite: 2
sections_add: 1
keyword_positions_dropped: 5
new_serp_features_count: 2
intent_shift: none
content_goal_change: none
content_timing_change: none
seed_signals_count: 2
```

## Handling External Posts

Posts not created by the content pipeline lack pipeline metadata (`phases/` artifacts). Handle gracefully:

1. **Reconstruct content goal:**
   - Scan for Builder.io mentions. If present and promotional: `acquisition`. If present as CTA only: `hybrid`. If absent: `awareness`.
   - Default to `awareness` if unclear.

2. **Reconstruct content timing:**
   - Default to `evergreen` for all external posts (if it existed long enough to need a refresh, it is evergreen).

3. **Reconstruct target keywords:**
   - Extract from the post's title, H2 headings, and first paragraph.
   - Cross-reference with the fresh keyword data from Phase 1 to validate.

4. **Skip SERP delta comparison:**
   - No original SERP baseline exists. Set `original_serp_data: unavailable`.
   - Use the current SERP as the sole reference for section analysis.

5. **Mark in output:**
   - `has_pipeline_metadata: false` in `original_post`

## Handling Trending-to-Evergreen Transitions

If the original post was `trending` (no SERP data at creation) and SERP data now exists:

1. Recommend `content_timing_change: recommended` with reason "SERP data now available"
2. Run full SERP comparison against the post content (there is no original SERP to compare against, so use the current SERP as baseline)
3. The refresh effectively brings the post up to evergreen standards: full keyword targeting, SERP-informed structure, featured snippet optimization

This often triggers a `selective-rewrite` or `full-rewrite` scope because the original post was optimized without SERP data.

## Examples

### Example 1: Selective Rewrite -- Outdated Code Examples

**Original post:** "How React Server Components Work" (published 6 months ago, Next.js 14 examples)
**Primary keyword:** "react server components" (was #3, now #8)

**Delta findings:**
- 2 of 6 sections have outdated Next.js 14 code examples
- 1 new competitor section on streaming (3 of top 5 cover it)
- AI Overview now present (was not before)
- 2 new PAA questions

**Scope:** `selective-rewrite` (2 REWRITE + 1 ADD = 50% affected)

**Section plan:**
- Introduction: KEEP
- What Are RSC: KEEP
- How Do RSC Differ: REWRITE (add streaming/Suspense)
- Build Your First RSC: REWRITE (update to Next.js 15 API)
- RSC and Streaming: ADD (new section, insert after Build)
- FAQ: REWRITE (add new PAA questions)
- Conclusion: KEEP

### Example 2: Metadata-Only -- Still Strong

**Original post:** "Headless CMS Comparison" (published 3 months ago)
**Primary keyword:** "headless cms comparison" (was #5, now #6)

**Delta findings:**
- 0 sections need rewriting (content still accurate)
- 0 new competitor sections needed
- Meta description could be stronger (current one is generic)
- Schema markup missing FAQPage type

**Scope:** `metadata-only`

### Example 3: Full Rewrite -- Major Intent Shift

**Original post:** "What Is Qwik?" (published 12 months ago)
**Primary keyword:** "qwik framework" (was #4, now #22)

**Delta findings:**
- SERP intent shifted from informational to commercial (now dominated by comparisons)
- Core premise outdated (Qwik 2.0 released with significant API changes)
- 4 of 5 sections need rewriting
- 3 new competitor sections needed

**Scope:** `full-rewrite` (>40% sections affected + major intent shift)

### Example 4: External Post Refresh

**Original post:** External blog post (no pipeline metadata)
**URL:** `https://techblog.example.com/react-hooks-guide`

**Handling:**
- Reconstructed content goal: `awareness` (no Builder.io mentions)
- Reconstructed timing: `evergreen`
- Reconstructed keywords: "react hooks", "usestate", "useeffect" (from title and headings)
- SERP delta: unavailable (no original baseline)
- Section analysis uses current SERP as sole reference

## Guidelines

- The delta analysis is a recommendation, not a decision. The user chooses the final scope at Gate 1.
- Be conservative with REWRITE classifications. Only mark REWRITE when content is demonstrably outdated, inaccurate, or significantly weaker than competitors. Minor improvements are better handled by the Content Editing phase.
- ADD sections should represent genuine content gaps, not nice-to-haves. If only 1 of 5 competitors covers a subtopic, it is likely not worth adding.
- Seed signals from the user override automated analysis. If the user says a section is outdated, mark it REWRITE regardless of automated findings.
- For metadata-only scope, downstream phases skip directly to SEO re-optimization (Phase 7 in the refresh pipeline). No content changes occur.
- The `positions_dropped` metric is the strongest single signal. A post that dropped 15+ positions almost always needs a full rewrite.
- See [delta-thresholds.md](./references/delta-thresholds.md) for the complete threshold table and evaluation details.
