---
name: post-publish-checklist
description: "This skill should be used when performing the final QA pass before a blog post is considered publish-ready. It covers meta description verification, image alt text audit, link validation, internal/external link counts, CTA review, word count confirmation, schema markup validation, E-E-A-T signal check, YAML frontmatter completeness, metadata.yaml assembly, repurposing hook identification, and social distribution preparation. Updates pipeline_status to complete."
---

# Post-Publish Checklist

Run the final QA pass on a blog post after all creation and optimization phases (1-10) have completed. This phase does not modify post content -- it verifies, validates, and assembles. If a check fails, flag it for manual fix before publishing.

## When to Use This Skill

- After AEO optimization (Phase 9) has completed
- When the `/content-blog` or `/content-lfg` orchestrator skill reaches Phase 10
- When re-validating a post after manual edits

## Prerequisites

- AEO-optimized draft in `post.md` (from Phase 9, status: `aeo-optimized`)
- All phase files in `phases/` (01 through 09)
- Outline in `outline.md`
- Research notes in `research-notes.md`
- Schema markup in `post.md` frontmatter (generated at Phase 8)
- Topic validation in `phases/01-topic-validation.yaml` (for `content_goal` and `content_timing`)

## Process

### Step 0: Check Content Timing, Content Goal, and Hub Context

Read `content_timing`, `content_goal`, `hub_slug`, and `page_type` from `phases/01-topic-validation.yaml`.

**Content timing:**
- If `content_timing: trending`: The checklist still runs in full, but expect and accept zeros or empty values in SERP-derived metadata fields (`search_intent`, `has_ai_overview`, `has_featured_snippet`, `competitors`). Add the trending follow-up item to the checklist (see Trending Topic Mode section).
- If `content_timing: evergreen`: All checks apply at full strength.

**Content goal** (drives CTA and link verification):
- `awareness`: Verify no promotional Builder.io mentions. Internal links to Builder.io blog posts are fine.
- `acquisition`: Verify Builder.io product links are present and the integration section exists.
- `hybrid`: Verify Builder.io CTA appears in the conclusion only, not scattered throughout.

**Hub context:**
- If `hub_slug` is present: read `output/hubs/<hub_slug>/hub.yaml`. Hub-aware checks activate in Step 7 (schema), Step 9 (link verification), Step 12 (metadata), and Step 13 (status updates). Load [hub-publish-checks.md](./references/hub-publish-checks.md) for the full hub validation process. Consult [hub-linking](../hub-linking/SKILL.md) for link rules.
- If `hub_slug` is absent: `page_type` defaults to `standalone`. All steps run in standard mode.

### Step 1: YAML Frontmatter Completeness

Verify that `post.md` has all required frontmatter fields:

| Field | Required | Validation |
|-------|----------|------------|
| `title` | Yes | Non-empty, matches title tag from Phase 8 |
| `slug` | Yes | Lowercase, hyphenated, contains primary keyword |
| `meta_description` | Yes | 120-155 characters, contains primary keyword |
| `primary_keyword` | Yes | Matches `phases/02-keyword-research.yaml` |
| `secondary_keywords` | Yes | Array, at least 2 items |
| `content_goal` | Yes | One of: awareness, acquisition, hybrid |
| `content_timing` | Yes | One of: evergreen, trending |
| `post_type` | Yes | One of: tutorial, comparison, explainer, how-to, thought-leadership |
| `word_count` | Yes | Number, matches actual word count |
| `status` | Yes | Should be `aeo-optimized` at this point |
| `author` | Yes | Non-empty |
| `date` | Yes | ISO 8601 format (YYYY-MM-DD) |
| `schema_type` | Yes | At least `BlogPosting`, may include `FAQPage`, `HowTo` |

**Action on failure:** Flag missing or invalid fields. Do not invent values -- the human must supply them.

### Step 2: Meta Description Verification

Read `meta_description` from `post.md` frontmatter.

**Checks:**

| Check | Target | Action if Failed |
|-------|--------|-----------------|
| Length | 120-155 characters | Flag: "Meta description is [N] chars, target 120-155" |
| Primary keyword present | Contains primary keyword or close variant | Flag: "Primary keyword missing from meta description" |
| Formula compliance | Follows `[What you'll learn]. [Proof]. [CTA].` pattern | Flag with suggestion |
| No truncation risk | Complete thought within 155 chars | Flag if sentence is cut mid-thought |
| Unique | Does not duplicate the title tag | Flag if substantially identical to title |

### Step 3: Image Alt Text Audit

Scan `post.md` for all image references (`![alt](url)` or `<img>` tags).

**Note:** Images are manually added by the author. This checklist only verifies alt text for existing images -- it does not generate or source images.

**Checks per image:**

| Check | Target | Action if Failed |
|-------|--------|-----------------|
| Alt text present | Non-empty `alt` attribute | Flag: "Image at line [N] missing alt text" |
| Alt text descriptive | More than 3 words, describes the image content | Flag: "Alt text '[text]' is too generic" |
| Alt text keyword | At least one image alt contains primary keyword naturally | Suggest adding keyword to the most relevant image alt |
| No "image of" prefix | Alt text does not start with "image of" or "picture of" | Flag for rewrite |

If the post contains zero images, record `images_count: 0` and skip this step. Do not flag the absence of images -- image decisions are editorial.

### Step 4: Link Validation

Scan `post.md` for all hyperlinks (markdown `[text](url)` and HTML `<a>` tags).

**Categorize each link:**
- **Internal:** Links to Builder.io domain (blog posts, docs, product pages)
- **External:** Links to other domains (official docs, competitor sites, tools)
- **Anchor:** In-page links (`#section-name`)

**Checks:**

| Check | Target | Action if Failed |
|-------|--------|-----------------|
| Internal link count | 2-3 links (from Phase 8) | Flag if 0-1 or >5 |
| External link count | 2-3 authoritative sources (from Phase 8) | Flag if 0-1 or >5 |
| No broken anchors | All `#section-name` anchors match an actual heading | Flag broken anchors |
| Link text descriptive | No "click here" or bare URLs | Flag generic link text |
| External links authoritative | Point to official docs, reputable sources | Flag links to low-authority domains |
| No nofollow needed | External links to authoritative sources do not need nofollow | Informational only |

**Content goal adjustments:**
- `awareness`: Verify internal links are to educational Builder.io blog posts, not product pages.
- `acquisition`: Verify at least 1 internal link points to a Builder.io product or feature page.
- `hybrid`: Verify CTA link in conclusion points to a relevant Builder.io page.

### Step 5: CTA Review

Locate the call-to-action in `post.md`.

**Checks by content goal:**

| Content Goal | CTA Location | CTA Type | Check |
|-------------|-------------|----------|-------|
| `awareness` | None required | No CTA or soft educational CTA | Verify no product pitch exists |
| `acquisition` | Integration section + conclusion | Product-specific CTA | Verify CTA links to a Builder.io page, is specific (not "check out Builder.io"), mentions a concrete benefit |
| `hybrid` | Conclusion only | Targeted CTA | Verify CTA is in the conclusion, not scattered, links to a relevant page, and follows the 80/20 rule (80% educational, 20% product) |

**CTA quality checks (acquisition and hybrid only):**

| Check | Target | Action if Failed |
|-------|--------|-----------------|
| Specificity | Names a concrete action ("Try the Visual Editor", not "Learn more") | Flag as vague |
| Relevance | CTA relates to the post topic | Flag if disconnected |
| Single CTA | One primary CTA per post | Flag if multiple competing CTAs |

### Step 6: Word Count Confirmation

Count the actual words in `post.md` body (excluding frontmatter and code blocks). See [word-count-guidance.md](../shared/word-count-guidance.md) for the full word count logic.

**Checks:**

| Check | Target | Action if Failed |
|-------|--------|-----------------|
| Matches frontmatter | `word_count` field matches actual count | Update frontmatter to match actual |
| Within target range | Within the competitive range from outline + Phase 8-9 buffer (3-5%) | Flag if significantly over |
| Overage justified | If over the target, verify the excess is from AEO/SEO improvements | Flag if overage comes from non-AEO additions |
| Excessive overage | 50%+ above the competitive median (or above guidance soft max if no SERP data) | Flag as problem: "Post is {X} words, {Y}% above competitive median of {Z}" |

Record `final_word_count` in the output.

### Step 7: Schema Markup Validation

Read the schema markup (JSON-LD) from `post.md` frontmatter or a `<script type="application/ld+json">` block.

**Checks:**

| Check | Target | Action if Failed |
|-------|--------|-----------------|
| BlogPosting or Article present | BlogPosting required for standalone/cluster; Article required for pillar (see hub checks) | Flag as critical: "Missing BlogPosting/Article schema" |
| FAQPage present | Required if post has FAQ section | Flag if FAQ section exists but no FAQPage schema |
| HowTo present | Required if post type is tutorial or how-to | Flag if post type matches but no HowTo schema |
| `datePublished` | ISO 8601 format, matches `date` frontmatter | Flag date mismatch |
| `dateModified` | ISO 8601 format, same as or after `datePublished` | Flag if before `datePublished` |
| `author` | Has `name` and `url` fields | Flag if missing |
| `headline` | Matches `title` frontmatter | Flag mismatch |
| `description` | Matches `meta_description` frontmatter | Flag mismatch |
| Valid JSON | Parseable JSON-LD | Flag syntax errors |
| Google Rich Results Test | Note: manual step -- include the test URL for the author | Record: "Validate at https://search.google.com/test/rich-results" |

**Canonical URL check:**
- If the post will be cross-posted (Dev.to, Medium, etc.), verify `canonical_url` is set in frontmatter pointing to the Builder.io original.
- If not cross-posting, `canonical_url` is optional. Record which case applies.

**Hub schema check** (when `hub_slug` is present): Pillar pages must use `Article` schema with `hasPart` array, not `BlogPosting`. Cluster pages must include `isPartOf` pointing to the pillar. See [hub-publish-checks.md](./references/hub-publish-checks.md) for details.

### Step 8: E-E-A-T Signal Check

Verify the 4 pillars of Experience, Expertise, Authoritativeness, and Trustworthiness are present.

| Pillar | What to Look For | Minimum |
|--------|-----------------|---------|
| **Experience** | Original examples, benchmarks, screenshots, "I built/tested" language | At least 1 original example or benchmark |
| **Expertise** | Author bio, technical depth, correct terminology | Author field populated, no factual errors flagged |
| **Authoritativeness** | External citations, links to official sources, cited data | At least 2 external authoritative links |
| **Trustworthiness** | Evidence for claims, acknowledged limitations, no misleading statements | Claims backed by data or examples |

**Action on failure:** Flag missing pillar with specific suggestion. E-E-A-T is not automated -- the author must add genuine experience signals.

### Step 8b: Factual Claims Verification

Verify that factual claims in the post are accurate against current sources. This step catches stale data that entered the pipeline during Phase 4 (content research) but became outdated by publish time.

**When to run at full rigor:**
- Comparison posts ("X vs Y") -- every capability claim about each tool
- Posts mentioning AI models -- model names and versions change monthly
- Posts mentioning pricing -- pricing tiers change frequently
- Content refreshes -- ALL facts from the original post need re-verification

**Verification checklist:**

| Claim Type | Verification Method | Example |
|-----------|-------------------|---------|
| Model versions | WebSearch "[tool] latest model [current year]" | GPT-5 → check if GPT-5.3-Codex is current |
| Feature claims | WebFetch on official docs | "Claude Code supports MCP Apps" → verify on docs |
| Pricing | WebFetch on pricing page | "$20/month Pro tier" → verify current price |
| Version numbers | WebFetch on release notes | "React 19.1" → verify latest stable |
| Capability claims | WebFetch on official docs | "Cursor has subagents" → verify on cursor.com/docs |
| Benchmark data | Source URL still accessible | Link to benchmark report still resolves |

**Process:**
1. Scan `post.md` for factual claims: product features, model names, version numbers, pricing, capability comparisons.
2. For each claim, run a quick WebSearch or WebFetch against the official source.
3. Flag any claim that is outdated or incorrect as a **critical issue**.
4. Record verified claims and their sources in the output YAML.

**Action on failure:** Flag outdated claims with the current correct information. The author must update before publishing.

**Content timing note:** For trending posts, facts may be hours old and inherently fresh. Focus verification on claims about OTHER tools mentioned in the post, not the trending topic itself.

### Step 9: Reverse Internal Linking Audit

Verify that the Phase 8 reverse internal linking recommendations have been noted.

**Check:** Read `phases/08-seo-optimization.yaml` for the `reverse_internal_links` field (3-5 existing posts that should link to the new post).

**Action:** Record the list in the output. These links are added post-publish by updating the existing posts. This is a reminder, not a blocker.

**Hub mode** (when `hub_slug` is present): After the standard audit, run the hub link verification checks from [hub-publish-checks.md](./references/hub-publish-checks.md). This verifies pillar ↔ cluster bidirectional links, sibling links, and reverse link patches. Hub link failures at Critical severity block the checklist.

### Step 10: Repurposing Hooks

Scan `post.md` for sections that could be repurposed into other content formats.

**Identify candidate sections:**

| Format | Best Candidates | Criteria |
|--------|----------------|----------|
| LinkedIn post | Self-contained explainers, key insights | Under 300 words, makes a single clear point |
| X/Twitter thread | Data-driven sections, numbered lists, step-by-step | Has 3-7 discrete points with concrete details |
| Short-form video | Before/after comparisons, visual demonstrations | Shows transformation or has visual element |
| Dev.to cross-post | The entire post | Always a candidate if canonical URL is set |

**Process:**
1. Scan each H2 section for repurposing potential.
2. Score each candidate: is it self-contained? Does it have a hook? Is it under the format's length limit?
3. Record the top 3-5 candidates in the output YAML.

### Step 11: Social Distribution Checklist

Prepare the social distribution plan. These are not automated -- they are prompts for the author.

**Checklist items:**

- [ ] LinkedIn key insight post drafted (link in comments, not in post body)
- [ ] X/Twitter thread of key takeaways outlined (3-7 tweets)
- [ ] Internal links added to 3-5 existing Builder.io posts pointing to the new post (from Step 9)
- [ ] Dev.to cross-post prepared with canonical URL (if applicable)
- [ ] Newsletter inclusion noted (if applicable)

Record the checklist in the output. All items start unchecked -- the author completes them post-publish.

### Step 12: Assemble metadata.yaml

Merge key fields from all phase files into a single `metadata.yaml` at the post output root.

**Assembly process:**
1. Read each file in `phases/` (01 through 09).
2. Extract the key fields from each (listed below).
3. Add post-publish-checklist results.
4. Write the merged `metadata.yaml`.

**Fields to extract per phase:**

| Phase File | Fields |
|-----------|--------|
| `01-topic-validation.yaml` | `topic`, `content_goal`, `content_timing`, `builder_relevance`, `hub_slug`, `page_type` |
| `02-keyword-research.yaml` | `primary_keyword`, `secondary_keywords`, `search_volume`, `keyword_difficulty` |
| `03-serp-analysis.yaml` | `search_intent`, `has_ai_overview`, `has_featured_snippet`, `competitors_count` |
| `04-content-research.yaml` | `sources_consulted`, `synthesis_themes` |
| `05-outline-creation.yaml` | `post_type`, `hook_type`, `copywriting_framework`, `title_chosen` |
| `06-blog-drafting.yaml` | `word_count`, `code_examples_count`, `sections_count` |
| `07-content-editing.yaml` | `compliance_score`, `critical_issues`, `ai_voice_score` |
| `08-seo-optimization.yaml` | `meta_description`, `title_tag`, `slug`, `schema_types`, `internal_links`, `external_links`, `reverse_internal_links` |
| `09-aeo-optimization.yaml` | `question_heading_ratio`, `answer_first_blocks`, `quote_ready_blocks_total`, `brand_radar` |

**metadata.yaml structure:**

```yaml
# Assembled by post-publish-checklist (Phase 10)
topic: "React Server Components"
content_goal: awareness
content_timing: evergreen
post_type: explainer
primary_keyword: "react server components"
secondary_keywords: ["RSC", "server-side rendering react", "next.js server components"]
search_volume: 12100
keyword_difficulty: 45
title: "How Do React Server Components Work Under the Hood?"
slug: react-server-components-guide
meta_description: "Learn how React Server Components reduce bundle size..."
author: "Vishwas"
date: "2026-02-08"
final_word_count: 2230
schema_types: ["BlogPosting", "FAQPage"]
search_intent: informational
compliance_score: 8
question_heading_ratio: 0.67
answer_first_blocks: 4
quote_ready_blocks: 9
internal_links: 3
external_links: 3
sources_consulted: 8
pipeline_status: complete
repurposing_hooks:
  - section: "What Are React Server Components?"
    format: linkedin_post
    reason: "Self-contained explainer, under 300 words"
  - section: "Performance Benchmarks"
    format: twitter_thread
    reason: "Data-driven, shareable numbers"
social_distribution:
  linkedin_post: pending
  twitter_thread: pending
  internal_links_added: pending
  devto_crosspost: pending
```

### Step 13: Write Output Artifacts and Update Status

**Update `post.md` frontmatter:** Set `status: publish-ready`.

**Set `pipeline_status: complete`** in `metadata.yaml` (assembled in Step 12).

**Hub mode** (when `hub_slug` is present): Update `hub.yaml` per [hub-publish-checks.md](./references/hub-publish-checks.md) -- set the current page status to `published`, update link statuses to `verified`, increment `ahrefs_units_consumed`, advance `current_page_index`, and recompute hub-level status.

**Write `phases/10-post-publish-checklist.yaml`** with results from each step:

```yaml
frontmatter_complete: true
frontmatter_issues: []
meta_description: { length: 142, has_primary_keyword: true, follows_formula: true, issues: [] }
images: { count: 3, alt_text_present: 3, alt_text_with_keyword: 1, issues: [] }
links: { internal_count: 3, external_count: 3, broken_anchors: 0, content_goal_compliant: true, issues: [] }
cta: { present: true, location: conclusion, specific: true, content_goal_compliant: true, issues: [] }
word_count: { final: 2230, within_range: true, issues: [] }
schema_markup: { blog_posting: true, faq_page: true, how_to: false, dates_valid: true, valid_json: true, canonical_url: null, issues: [] }
eeat: { experience: true, expertise: true, authoritativeness: true, trustworthiness: true, issues: [] }
reverse_internal_links: [{ url: "https://www.builder.io/blog/post-1", status: pending }, { url: "https://www.builder.io/blog/post-2", status: pending }]
repurposing_hooks: [{ section: "...", format: linkedin_post, reason: "..." }]
social_distribution: { linkedin_post: pending, twitter_thread: pending, internal_links_added: pending, devto_crosspost: pending }
content_goal: awareness
content_timing: evergreen
page_type: standalone  # standalone | pillar | cluster
hub_slug: null         # hub slug when page_type is pillar or cluster
pipeline_status: complete
checklist_pass: true  # true if zero critical issues
critical_issues_count: 0
important_issues_count: 0
minor_issues_count: 0
status: publish-ready
```

Each top-level key maps to a step. Expand nested fields as needed -- the compact format above shows the structure.

## Trending Topic Mode

When `content_timing: trending`, the checklist runs in full but adjusts expectations for SERP-derived data.

### What Changes

1. **Step 0:** Accept zeros or empty values in SERP-derived metadata fields. The following fields in `metadata.yaml` may be empty or zero: `search_intent`, `has_ai_overview`, `has_featured_snippet`, `competitors_count`, `search_volume` (may show social-signal estimate instead of Ahrefs data).

2. **Step 7 (Schema Markup):** `datePublished` is especially important for trending topics -- timeliness is a ranking signal. Verify the date is accurate to the day.

3. **Step 12 (metadata.yaml):** Add a `trending_followup` field:
   ```yaml
   trending_followup:
     scheduled: "2-4 weeks post-publish"
     action: "Run /content-compound to retroactively validate keywords, assess SERP position, and refine SEO once Ahrefs data populates"
   ```

4. **Social Distribution (Step 11):** Add a trending-specific item:
   - [ ] Post-publish follow-up scheduled: run `/content-compound` in 2-4 weeks to retroactively validate keywords, assess SERP position, and refine SEO once Ahrefs data populates

### What Stays the Same

- All verification steps (frontmatter, meta description, images, links, CTA, word count, schema, E-E-A-T) run at full strength
- Repurposing hooks are identified normally
- `pipeline_status` is set to `complete`
- The checklist is pass/fail -- trending posts still need to pass QA

## Issue Severity

Issues found during the checklist follow the same severity classification from the Style Guide skill:

| Severity | Action | Examples |
|----------|--------|----------|
| **Critical** | Must fix before publish | Missing schema markup, broken links, no meta description, word count 50%+ above competitive median |
| **Important** | Should fix | Generic alt text, vague CTA, meta description out of range, missing E-E-A-T pillar |
| **Minor** | Consider | Suboptimal link text, canonical URL not set (when not cross-posting), fewer repurposing hooks than expected |

A post with zero critical issues passes the checklist. Important and minor issues are recorded but do not block publishing.

## Examples

### Example 1: Clean Pass (Evergreen, Acquisition)

**Input:** Evergreen acquisition post about headless CMS comparison, 2,310 words, all phases completed.

**Checklist results:**
- Frontmatter: All 13 fields present and valid
- Meta description: 148 chars, contains "headless CMS", follows formula
- Images: 2 comparison screenshots, both have descriptive alt text, 1 contains keyword
- Links: 3 internal (1 to Builder.io product page, 2 to blog posts), 3 external (React docs, Contentful docs, Web Almanac)
- CTA: In integration section + conclusion, specific ("Try Builder.io's Visual Editor for your next React project"), links to product page
- Word count: 2,310 matches frontmatter, within range
- Schema: BlogPosting + FAQPage, all fields valid, dates match
- E-E-A-T: Original benchmark data (Experience), author bio present (Expertise), 3 authoritative external links (Authoritativeness), benchmarks cite methodology (Trustworthiness)
- Repurposing hooks: 4 candidates identified (2 LinkedIn posts, 1 X thread, 1 Dev.to crosspost)

**Result:** `checklist_pass: true`, `pipeline_status: complete`

### Example 2: Failed Check (Missing Schema)

**Input:** Tutorial post, 2,180 words. Post has a step-by-step section but no HowTo schema markup.

**Checklist results (excerpt):**
```yaml
schema_markup:
  blog_posting: true
  faq_page: false  # no FAQ section, so not required
  how_to: false    # PROBLEM: post type is tutorial, HowTo schema required
  issues:
    - severity: critical
      message: "Post type is 'tutorial' but HowTo schema markup is missing. Add HowTo JSON-LD per schema-markup-templates.md."
```

**Result:** `checklist_pass: false` (1 critical issue). Author must add HowTo schema before publishing.

### Example 3: Trending Topic Checklist

**Input:** Trending topic about a just-announced React feature, `content_timing: trending`, 1,850 words.

**Checklist results (excerpt):**
```yaml
# SERP-derived fields accepted as empty/zero for trending
schema_markup:
  date_published_valid: true  # Especially important for trending
  issues: []

# Trending follow-up added
trending_followup:
  scheduled: "2-4 weeks post-publish"
  action: "Run /content-compound to retroactively validate keywords"

social_distribution:
  linkedin_post: pending
  twitter_thread: pending
  internal_links_added: pending
  devto_crosspost: pending
  trending_followup: pending  # Run /content-compound in 2-4 weeks

# metadata.yaml has empty SERP fields -- not flagged
search_intent: null  # Accepted: trending topic, no SERP data
has_ai_overview: null
has_featured_snippet: null
```

**Result:** `checklist_pass: true` (zero critical issues despite empty SERP data).

### Example 4: Repurposing Hook Identification

**Post sections scanned:**

| Section | Candidate? | Format | Reason |
|---------|-----------|--------|--------|
| "What Are Server Components?" | Yes | `linkedin_post` | Self-contained explainer, 220 words |
| "How Do RSC Fetch Data?" | No | -- | Requires preceding context |
| "Performance Benchmarks" | Yes | `twitter_thread` | 5 data points, each tweetable |
| "Migration Guide" | Yes | `short_video` | Before/after code comparison |
| "FAQ" | No | -- | Too fragmented for standalone |

**Output:**
```yaml
repurposing_hooks:
  - section: "What Are Server Components?"
    format: linkedin_post
    reason: "Self-contained explainer, 220 words, clear single point"
  - section: "Performance Benchmarks"
    format: twitter_thread
    reason: "5 data points with concrete numbers, each under 280 chars"
  - section: "Migration Guide"
    format: short_video
    reason: "Before/after code comparison, visual transformation"
```

## Guidelines

- This checklist verifies -- it does not rewrite. If a check fails, flag it for the author. Do not silently fix content issues at this stage.
- The only field this phase updates in `post.md` is `status: publish-ready`. All other frontmatter corrections are flagged, not applied.
- `metadata.yaml` is assembled from phase files, not invented. If a phase file is missing a field, record `null` and flag it.
- Images are a manual editorial decision. Never flag the absence of images -- only validate alt text on images that exist.
- Repurposing hooks are suggestions, not requirements. A post with zero repurposing hooks is still publishable.
- Social distribution items are prompts for the author. They are recorded as `pending` and completed outside the pipeline.
- The Google Rich Results Test is a manual step. Include the URL as a reminder -- do not attempt to call the tool.
- For trending topics, empty SERP-derived fields are expected, not errors. The follow-up scheduling item ensures these gaps are addressed retroactively.
- `pipeline_status: complete` means the automated pipeline is done. It does not mean the post is published -- the author makes the final call.
