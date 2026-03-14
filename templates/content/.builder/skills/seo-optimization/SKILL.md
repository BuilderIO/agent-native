---
name: seo-optimization
description: "This skill should be used when optimizing a blog post for on-page SEO after editing. It covers meta description writing, title tag optimization, slug optimization, keyword placement verification, E-E-A-T signal checks, featured snippet verification, internal and external linking, schema markup generation, and search intent cross-checking. Produces SEO metadata and modifies post.md in-place."
---

# SEO Optimization

Optimize an edited blog post (`post.md`) for on-page SEO. This phase runs after content editing (Phase 7) and before AEO optimization (Phase 9). The goal is search visibility without sacrificing readability -- apply high-impact SEO factors and skip low-value optimizations.

## When to Use This Skill

- After the editing phase (Phase 7) has completed
- When the `/content-blog` or `/content-lfg` orchestrator skill reaches Phase 8
- When re-optimizing a post after content changes

## Prerequisites

- Edited draft in `post.md` (from Phase 7, status: `edited`)
- Keywords in `phases/02-keyword-research.yaml` (primary, secondary, semantic)
- SERP analysis in `phases/03-serp-analysis.yaml` (may be `skipped: true` for trending topics)
- Outline in `outline.md` (for featured snippet flags and post type)
- Topic validation in `phases/01-topic-validation.yaml` (for `content_goal` and `content_timing`)
- Editing metadata in `phases/07-content-editing.yaml` (for current word count)

## High-Impact vs Low-Impact SEO Factors

Focus effort on what moves the needle. Ignore vanity metrics.

**High-impact (apply rigorously):**
- Search intent match (most important -- verify the post answers what searchers want)
- Title tag with primary keyword near the beginning
- Content quality and depth (already handled by Phases 6-7)
- E-E-A-T signals (author authority, original examples, cited sources)
- Header hierarchy with keywords in H2s
- Meta description that drives clicks

**Low-impact (do NOT over-optimize):**
- Keyword density -- ignore. Natural keyword usage from drafting is sufficient.
- Exact keyword in URL slug -- marginal benefit, prioritize readability
- Meta keywords tag -- ignored by Google since 2009
- Exact word count targets -- write for completeness, guided by SERP competitive range, not arbitrary numbers

## Process

### Step 0: Check Content Timing, Content Goal, and Hub Context

Read `content_timing`, `content_goal`, `hub_slug`, and `page_type` from `phases/01-topic-validation.yaml`.

**Content timing:**
- If `content_timing: trending`: See the Trending Topic Mode section below for per-step adjustments.
- If `content_timing: evergreen`: Apply all steps at full rigor.

**Content goal** (drives linking and E-E-A-T checks):
- `awareness`: Internal links to related Builder.io blog posts are fine (subtle, SEO-helpful). External links to neutral, authoritative sources.
- `acquisition`: Internal links to Builder.io blog posts, docs, and product pages. External links to authoritative sources that reinforce the problem Builder.io solves.
- `hybrid`: Internal links to related Builder.io blog posts throughout, plus 1 product/docs link in the conclusion CTA. External links throughout the body.

**Hub context** (drives linking and schema):
- If `hub_slug` is present: read `output/hubs/<hub_slug>/hub.yaml`. Extract the `links:` section, the current page's slug (`page_slug`), and `page_type` (`pillar` or `cluster`). Hub-aware behavior activates in Step 8 (linking) and Step 9 (schema). Load the [hub-linking](../hub-linking/SKILL.md) skill for link implementation rules.
- If `hub_slug` is absent: `page_type` defaults to `standalone`. All steps run in standard mode.

### Step 1: Read Inputs

Load from the post output folder:

1. `post.md` -- the edited draft
2. `phases/02-keyword-research.yaml` -- primary keyword, secondary keywords, semantic keywords
3. `phases/03-serp-analysis.yaml` -- search intent, SERP features, competitors (may be `skipped: true`)
4. `outline.md` -- post type, featured snippet flags per section, heading structure
5. `phases/01-topic-validation.yaml` -- content goal, content timing, hub_slug, page_type
6. `phases/07-content-editing.yaml` -- word count after editing
7. If `hub_slug` is set: `output/hubs/<hub_slug>/hub.yaml` -- hub definition with links section

### Step 2: Meta Description

Write a meta description for the post. This appears in search results and drives click-through rate.

**Formula:** `[What you'll learn]. [Proof/credibility]. [Call to action].`

**Rules:**
1. Length: 120-155 characters. Under 120 is too short (Google may replace it). Over 155 gets truncated.
2. Include the primary keyword naturally -- not forced, not at the start if it reads awkwardly.
3. Include a specific number, result, or proof point when possible.
4. End with an implicit or explicit call to action.
5. Do not start with "In this article..." or "This post covers..." -- these waste characters.
6. Do not duplicate the title tag.

**Examples:**

Good: `React Server Components cut client JS by 64% in our tests. Learn when to use them, with code examples and migration steps.` (127 chars)

Good: `Build type-safe APIs in 5 minutes with tRPC and Next.js. Step-by-step setup with error handling and authentication patterns.` (125 chars)

Bad: `In this comprehensive guide, we explore React Server Components and their benefits for modern web development.` (too generic, no proof, "comprehensive guide")

Add the meta description to `post.md` frontmatter as `meta_description`.

### Step 3: Title Tag Optimization

Review the title from `post.md` frontmatter. Optimize for search without losing the human appeal established in Phase 5.

**Formula:** `[Primary Keyword]: [Benefit/Hook] | Builder.io`

**Rules:**
1. Length: 50-60 characters (excluding the ` | Builder.io` suffix, which the CMS appends). Google truncates at ~60 characters.
2. Primary keyword should appear in the first half of the title.
3. Do not keyword-stuff. One primary keyword per title.
4. Preserve the curiosity or specificity that Phase 5's title scoring established. SEO optimization should refine, not replace, the chosen title.
5. If the title already scores well on both SEO and human appeal, leave it alone.

**Content goal adjustments:**
- `awareness`: Omit ` | Builder.io` suffix. The title stands alone.
- `acquisition` / `hybrid`: Include ` | Builder.io` suffix (CMS default).

**Examples:**

Before: `Why Server Components Are a Big Deal` (no keyword)
After: `React Server Components: Why They Change Everything | Builder.io` (keyword first, benefit)

Before: `A Complete Guide to tRPC` ("complete guide" is weak)
After: `tRPC Tutorial: Type-Safe APIs in Next.js | Builder.io` (keyword + specific benefit)

If the title already has the primary keyword in a strong position, do not change it.

### Step 4: Slug Optimization

Review the URL slug (from `post.md` frontmatter `slug` field or derived from the title).

**Rules:**
1. Include the primary keyword or its core noun phrase.
2. Keep it short: 3-6 words, separated by hyphens.
3. Remove stop words (a, the, in, of, for, and) unless they clarify meaning.
4. Lowercase only.
5. No dates in the slug (dates make content look stale when updated).

**Examples:**

Title: `React Server Components: Why They Change Everything`
Slug: `react-server-components-guide`

Title: `tRPC Tutorial: Type-Safe APIs in Next.js`
Slug: `trpc-nextjs-tutorial`

Update the `slug` field in `post.md` frontmatter if changed.

### Step 5: Keyword Placement Verification

Verify that keywords appear in the right places. Do NOT add keywords where they don't fit naturally -- the drafting phase (Phase 6) should have placed them. This step verifies and fills gaps.

**Placement checklist:**

| Location | Keyword | Required | Notes |
|----------|---------|----------|-------|
| Title tag | Primary | Yes | First half of title preferred |
| H2 headings | Primary or secondary | At least 2 of the H2s | Natural phrasing, not forced |
| First paragraph | Primary | Yes | Within the first 100 words |
| Meta description | Primary | Yes | Natural inclusion |
| Conclusion | Primary | Yes | Reinforcement, not repetition |
| Image alt text | Secondary or semantic | If images exist | Descriptive, not keyword-stuffed |
| Body paragraphs | Secondary + semantic | Naturally distributed | No density targets |

**Verification process:**
1. Search `post.md` for the primary keyword. Confirm it appears in title, first paragraph, at least 2 H2s, and conclusion.
2. Search for secondary keywords. Confirm at least 1 appearance each in body sections.
3. Search for semantic keywords. These should appear naturally -- do not force them. Note any that are completely absent for the output report.
4. If a required placement is missing, add the keyword naturally. If it cannot be added without sounding forced, note it as a minor issue and skip.

### Step 6: E-E-A-T Signal Check

Verify that the post demonstrates Experience, Expertise, Authoritativeness, and Trustworthiness. These are author authority signals that Google weights heavily after the December 2025 Helpful Content Update.

**E-E-A-T checklist:**

| Signal | What to Check | How to Fix |
|--------|--------------|------------|
| **Experience** | Post contains original code examples, benchmarks, or real project references | Add a personal observation or result from testing the topic |
| **Expertise** | Author bio is present in frontmatter with real credentials | Ensure `author` field has name, role, and relevant experience |
| **Authoritativeness** | Post links to external authoritative sources | Verify 2-3 external links to official docs, specs, or recognized authorities |
| **Trustworthiness** | Claims are supported with evidence; limitations are acknowledged | Flag unsupported claims. Add "Limitations" or "Trade-offs" notes where appropriate |

**Builder.io-specific E-E-A-T examples:**
- **Experience:** "I built a headless CMS integration using Builder.io's SDK and measured a 2.3s improvement in page load time."
- **Expertise:** Author bio: "Vishwas, DevRel at Builder.io. 10+ years in web development."
- **Authoritativeness:** Links to React docs, MDN, TC39 proposals, framework changelogs.
- **Trustworthiness:** "Server Components don't eliminate client-side React -- interactive elements still need client components."

Record which E-E-A-T signals are present in the output YAML. If a signal is weak or missing, note it as an important issue and add it if possible without disrupting the post's flow.

### Step 7: Featured Snippet Verification

Check whether sections flagged for featured snippet targeting in `outline.md` are properly formatted.

**Three snippet formats:**

1. **Definition snippet** -- A 40-60 word direct answer directly under the H2 question heading. Already placed as answer-first blocks in Phase 5/6. Verify the block exists and is concise enough (not over 60 words).

2. **List snippet** -- Numbered steps or bullet points for how-to/tutorial sections. Verify lists are properly formatted with consistent structure (each item starts with an action verb).

3. **Table snippet** -- Comparison tables for vs./comparison sections. Verify the table has clear headers, consistent columns, and enough rows to be useful (3+ rows).

**Verification process:**
1. Read the `featured_snippet_target` field for each section in `outline.md`.
2. For each flagged section, check the corresponding section in `post.md`.
3. Verify the format matches the target type (definition block, ordered list, or table).
4. If the format is missing or mismatched, restructure the section opening to match.

If no sections are flagged for snippet targeting, skip this step.

### Step 8: Internal and External Linking

Add links that support the post's authority and help readers navigate related content.

**Hub mode** (when `hub_slug` is present): Replace the standard internal linking process below with hub-aware linking from [hub-linking](../hub-linking/SKILL.md). See Step 8 Hub Mode below.

**Standard mode** (when `hub_slug` is absent):

**Internal links (pointing to other Builder.io blog posts or docs):**
- Target: 2-3 internal links per post
- Link to related Builder.io blog posts or documentation pages
- Use descriptive anchor text (not "click here" or "read more")
- Place links where they add context, not as an afterthought
- **Content goal adjustments:**
  - `awareness`: 2-3 links to related Builder.io blog posts (educational content, not product pages). Internal links are subtle and help SEO regardless of content goal.
  - `acquisition`: 2-3 links to Builder.io blog posts, docs, or product pages that relate to the topic
  - `hybrid`: 2-3 links to Builder.io blog posts throughout, plus 1 product/docs link in the conclusion CTA

**External links (pointing to authoritative third-party sources):**
- Target: 2-3 external links per post
- Link to official documentation, framework repos, specifications, or research
- Prefer primary sources (React docs > a blog post about React)
- Open external links in a new tab (`target="_blank"`)
- Do not link to direct competitors

**Internal linking audit (for new posts, standard mode only):**
When publishing a new post, identify 3-5 existing Builder.io blog posts that should link *to* this new post. Record these in the output YAML as `reverse_internal_links`. These are suggestions for the author to update manually after publication.

To identify candidates:
1. Search `site:builder.io/blog` for the primary keyword using WebSearch
2. Note posts that cover related topics but lack depth on this specific angle
3. Record the URL and suggested anchor text for each

#### Step 8 Hub Mode

When `hub_slug` is set, the internal linking process is deterministic -- links come from `hub.yaml`, not from WebSearch discovery. Follow the [hub-linking](../hub-linking/SKILL.md) skill's process (Steps 1-4).

**8a. Implement outbound hub links:**

For each entry in `hub.yaml` `links:` where `from == current_page_slug`:
1. Read the planned `anchor_text` and `placement` from `hub.yaml`
2. Locate the target zone in `post.md` (`intro`, `body`, or `conclusion`)
3. Insert the link as `[anchor text](https://www.builder.io/blog/target-slug)` in a natural sentence
4. If no existing sentence can carry the link, add a brief contextual sentence
5. Update the link status in `hub.yaml` from `planned` to `implemented`

Follow the hub-linking skill's anchor text strategy (50% primary keyword, 30% semantic variation, 20% natural phrase). Respect the link budget: pillar pages 15-20 internal links, cluster pages 5-8.

**8b. Generate reverse link patches:**

For inbound links where `to == current_page_slug` and the source page is already published:
1. Only generate patches for the **pillar page** -- never for already-published cluster pages
2. Write patches to `phases/08-seo-reverse-links.yaml` in the format defined by the hub-linking skill (Step 4)
3. Each patch includes `before` and `after` context for precise text replacement
4. The `/content-hub` orchestrator skill applies these patches after the cluster page completes

Cluster-to-cluster reverse links are deferred to hub finalization (not generated here).

**External links in hub mode:** The external linking rules (2-3 links to authoritative sources) still apply. Hub mode only replaces the *internal* linking process.

**Reverse internal linking audit:** Skip the WebSearch-based `reverse_internal_links` audit when in hub mode -- hub links replace it entirely.

### Step 9: Schema Markup Generation

Generate JSON-LD structured data for the post using the templates in [schema-markup-templates.md](./references/schema-markup-templates.md).

**Decision logic:**

| Post Type | Schema Types |
|-----------|-------------|
| Tutorial, How-To | BlogPosting + HowTo |
| Explainer with FAQ section | BlogPosting + FAQPage |
| Tutorial with FAQ section | BlogPosting + HowTo + FAQPage |
| Comparison, Thought Leadership | BlogPosting only |

**Process:**
1. Determine which schemas apply based on post type (from `outline.md`) and whether the post has a FAQ section.
2. Generate the base schema. For `page_type: pillar`, use `Article` instead of `BlogPosting` and add a `hasPart` array listing cluster page URLs (see hub schema section below). For all other page types, use `BlogPosting`. Populate from `post.md` frontmatter, Phase 2 keywords, and the meta description from Step 2.
3. If applicable, generate FAQPage schema from the FAQ section's question-answer pairs.
4. If applicable, generate HowTo schema from the tutorial's sequential steps.
5. If `page_type: cluster`, add `isPartOf` to the base schema pointing to the pillar page URL.
6. If multiple schemas, wrap in a `@graph` array per the reference file.
7. Add the generated JSON-LD to `post.md` frontmatter as `schema_markup` (the raw JSON-LD string) or write it to a separate `schema.json` file in the post output folder.

**Hub schema (when `hub_slug` is present):**

- **Pillar pages:** Use `Article` (not `BlogPosting`) with `hasPart` linking to all cluster pages. This signals to search engines that the pillar is a comprehensive resource with constituent parts. See [schema-markup-templates.md](./references/schema-markup-templates.md) for the Article + hasPart template.
- **Cluster pages:** Use `BlogPosting` (standard) with an added `isPartOf` property pointing to the pillar page URL. This establishes the parent-child relationship in structured data.
- **Standalone pages (`page_type: standalone`):** No change -- use BlogPosting as usual.

Schema validation is deferred to the Post-Publish Checklist (Phase 10).

### Step 10: Search Intent Cross-Check

Verify that the final post still matches the search intent identified in Phase 3 (SERP Analysis).

**Process:**
1. Read `search_intent` from `phases/03-serp-analysis.yaml`. Possible values: `informational`, `navigational`, `commercial`, `transactional`.
2. Compare the post's content against the intent:
   - **Informational:** Post should educate. Check that it answers the core question thoroughly, not just promote a product.
   - **Commercial:** Post should compare or evaluate. Check for balanced analysis, not one-sided promotion.
   - **Navigational:** Post should help users find something specific. Ensure clear navigation and direct answers.
   - **Transactional:** Post should guide toward an action. Ensure CTAs are clear and actionable.
3. If the post drifts from the identified intent (e.g., an informational query gets a promotional post), flag as an important issue.

**Trending mode exception:** If `phases/03-serp-analysis.yaml` has `skipped: true`, skip this cross-check entirely. Instead, note in the output: `search_intent_check: "deferred -- no SERP data for trending topic"`. Use the `primary_intent` from `phases/01-topic-validation.yaml` as a best-effort proxy if available.

### Step 11: Word Count Re-Check

Count words in `post.md` after all SEO additions (meta description doesn't count -- it's in frontmatter -- but any body text additions from linking or snippet restructuring do count). See [word-count-guidance.md](../shared/word-count-guidance.md) for the full word count logic.

- Check the draft against the word count target from the outline (`word_count_target` in `phases/05-outline-creation.yaml`). If over the target, flag as important issue. Do not trim here -- Phase 9 (AEO) may also add a small number of words within the 3-5% buffer.
- If the word count increased by more than 100 words from Phase 7, note it in the output.
- Update `word_count` in `post.md` frontmatter.

### Step 12: Write Output Artifacts

Update `post.md` frontmatter with SEO fields:

```yaml
meta_description: "..."
slug: "..."
schema_markup: BlogPosting  # or Article (pillar), BlogPosting + HowTo, etc.
word_count: [updated count]
status: seo-optimized
```

Write `phases/08-seo-optimization.yaml`:

```yaml
meta_description: "React Server Components explained with practical examples..."
meta_description_length: 148
title_tag_optimized: true  # or false if no changes needed
slug_optimized: true
keyword_placements:
  title: true
  h2s: 3
  first_paragraph: true
  meta_description: true
  conclusion: true
  missing_secondary: []  # list any secondary keywords not found in body
internal_links_added: 2
external_links_added: 3
reverse_internal_links:           # standard mode only (omit in hub mode)
  - url: "https://www.builder.io/blog/existing-post-slug"
    suggested_anchor: "descriptive anchor text"
schema_markup: BlogPosting  # or Article (pillar), BlogPosting + HowTo, etc.
schema_types_applied:
  - BlogPosting
eeat_signals:
  experience: true
  expertise: true
  authoritativeness: true
  trustworthiness: true
  missing: []  # list any weak or missing signals
featured_snippet_targets_verified: 2  # count of sections checked
search_intent_match: true  # or false if drift detected
word_count_before: 2180
word_count_after: 2210
content_goal: awareness  # from Phase 1
page_type: standalone  # standalone | pillar | cluster
status: seo-optimized

# Hub-specific fields (only present when hub_slug is set)
hub_slug: null                    # or the hub slug value
hub_links_implemented: 0          # count of outbound hub links inserted into post.md
hub_links_from_plan: 0            # total planned outbound links for this page
reverse_links_generated: false    # true if phases/08-seo-reverse-links.yaml was written
```

## Trending Topic Mode

When `content_timing: trending`, SEO optimization still runs but with reduced data.

### What Changes

1. **Step 5 (Keyword Placement):** Use social-signal-derived keywords from Phase 2 instead of Ahrefs-validated keywords. Placement rules still apply.
2. **Step 7 (Featured Snippet Verification):** Best-effort. No SERP baseline exists to know which snippets are achievable. Verify formatting is correct but do not prioritize snippet optimization.
3. **Step 8 (Internal/External Linking):** The `site:builder.io/blog` search for reverse internal links may return fewer results for novel topics. Accept fewer candidates.
4. **Step 10 (Search Intent Cross-Check):** Skip entirely. SERP analysis was skipped for trending topics. Note in output: `search_intent_check: "deferred -- trending topic, no SERP data at publish time"`. Use `primary_intent` from Phase 1 as a best-effort proxy.

### What Stays the Same

- Step 2 (Meta Description) -- always write one
- Step 3 (Title Tag Optimization) -- always optimize
- Step 4 (Slug Optimization) -- always clean the slug
- Step 6 (E-E-A-T Signal Check) -- authority signals matter regardless of timing
- Step 9 (Schema Markup) -- always generate structured data
- Step 11 (Word Count Re-Check) -- always verify the ceiling
- The output artifact format

### Trending Output Note

Add to `metadata.yaml` (assembled at Phase 10):

```yaml
seo_baseline: "deferred -- trending topic, no SERP data at publish time"
```

## Examples

### Example 1: Meta Description Writing

**Input (from post):** A tutorial on React Server Components covering when to use them, data fetching patterns, and migration from client components.

**Primary keyword:** `React Server Components`

**Draft:** `React Server Components cut client JS by 64% in our tests. Learn when to use them, with code examples and migration steps.` (127 chars)

**Checklist:**
- Length: 127 chars (within 120-155 range)
- Primary keyword: present ("React Server Components")
- Proof point: "64% in our tests"
- Call to action: "Learn when to use them"
- No "In this article..." opener
- Not a duplicate of the title

### Example 2: Keyword Placement Gap

**Primary keyword:** `headless CMS`
**Scan result:** Found in title, H2 #1, H2 #3, meta description. Missing from first paragraph and conclusion.

**Fix (first paragraph):** Added "A headless CMS separates..." to the opening answer-first block.
**Fix (conclusion):** Added "Whether you're evaluating a headless CMS for..." to the wrap-up paragraph.

**Note:** Both additions read naturally. Do not force keywords where they break flow.

### Example 3: E-E-A-T Signal Improvement

**Before (weak experience signal):**
> Server Components are useful for data-heavy pages because they reduce bundle size.

**After (strong experience signal):**
> Server Components are useful for data-heavy pages. Our dashboard page dropped from 245KB to 89KB of client JS after converting two data-fetching components -- a 64% reduction.

**Signal added:** Experience (original benchmark from a real project).

### Example 4: Schema Markup Decision

**Post type:** Tutorial (How to Build a Headless Blog with Next.js)
**Has FAQ section:** Yes (3 PAA questions at the end)

**Decision:** BlogPosting + HowTo + FAQPage (all three apply)
**Schema:** Wrapped in `@graph` array per [schema-markup-templates.md](./references/schema-markup-templates.md)

### Example 5: Trending Topic SEO

**Topic:** A newly announced React feature (content_timing: trending)
**Phase 3 SERP analysis:** `skipped: true`

**Adjustments:**
- Step 5: Use keywords from Phase 2 social signals (HN discussions, X posts)
- Step 7: Format snippet targets correctly but don't prioritize optimization
- Step 10: Skip search intent cross-check. Output: `search_intent_check: "deferred -- trending topic, no SERP data at publish time"`
- Output YAML includes: `seo_baseline: "deferred -- trending topic, no SERP data at publish time"`

## Guidelines

- SEO optimization refines; it does not rewrite. If the post reads well after Phase 7, most SEO changes should be small: a keyword added to the first paragraph, a meta description written, links inserted.
- Never sacrifice readability for SEO. A keyword that doesn't fit naturally is worse than a missing keyword.
- The meta description is the highest-ROI item in this phase. It directly controls click-through rate from search results. Spend the most effort here.
- Schema markup enables rich results but does not guarantee them. Generate it correctly and let Google decide what to display.
- Internal linking serves two purposes: it helps readers find related content AND it distributes page authority. Both matter.
- E-E-A-T is not a checklist to game. It reflects whether the content was written by someone with real experience. The signals should already exist from good drafting -- this step verifies they're visible to search engines.
- The reverse internal linking audit is aspirational. It identifies where new links *should* go, but the actual linking happens manually after publication. Record the suggestions; don't skip them.
