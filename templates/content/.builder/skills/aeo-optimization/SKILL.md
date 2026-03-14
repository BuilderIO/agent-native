---
name: aeo-optimization
description: "This skill should be used when optimizing a blog post for Answer Engine Optimization after SEO optimization. It verifies AEO heading compliance, refines specificity enhancers, audits quote-ready blocks, checks answer-first blocks, integrates Brand Radar data for AI visibility insights, and performs a final word count check. This is a verification and refinement pass -- AEO headings are drafted at outline time (Phase 5)."
---

# AEO Optimization

Verify and refine a blog post for Answer Engine Optimization -- the practice of structuring content so AI assistants (ChatGPT, Claude, Gemini, Perplexity, Google AI Overviews) can extract and cite it. This phase runs after SEO optimization (Phase 8) and before the post-publish checklist (Phase 10).

**This is a VERIFICATION pass, not the first attempt.** AEO headings and answer-first blocks are drafted at outline time (Phase 5) and written in Phase 6. Phase 9 verifies compliance, refines specificity enhancers, adds missing quote-ready blocks, and integrates Brand Radar data.

## When to Use This Skill

- After SEO optimization (Phase 8) has completed
- When the `/content-blog` or `/content-lfg` orchestrator skill reaches Phase 9
- When re-optimizing a post for improved AI citation performance

## Prerequisites

- SEO-optimized draft in `post.md` (from Phase 8, status: `seo-optimized`)
- Outline in `outline.md` (for heading structure, answer-first blocks, featured snippet targets)
- Keywords in `phases/02-keyword-research.yaml` (primary, secondary, semantic)
- Topic validation in `phases/01-topic-validation.yaml` (for `content_goal` and `content_timing`)
- SERP analysis in `phases/03-serp-analysis.yaml` (for PAA questions; may be `skipped: true` for trending topics)
- SEO metadata in `phases/08-seo-optimization.yaml` (for current word count)

## Why AEO Matters

AI assistants are becoming a primary information source for developers. Content structured for AI citation sees measurably higher engagement:

- **58%** AI visits uplift after AEO optimization (Graphite/Webflow case study)
- **94%** share of voice growth in AI responses
- **24%** LLM-traffic signup conversion rate vs 4% from non-brand SEO
- Quote-ready blocks appear in **34% more** LLM responses

AEO is especially high-value for trending topics -- AI assistants are among the first to answer questions about new announcements, so being citable from day one is critical.

## Process

### Step 0: Check Content Timing and Content Goal

Read `content_timing` and `content_goal` from `phases/01-topic-validation.yaml`.

**Content timing:**

- If `content_timing: trending`: See the Trending Topic Mode section below. AEO is MORE important for trending topics, not less. Apply all heading and block techniques at full strength. Skip Brand Radar only.
- If `content_timing: evergreen`: Apply all steps including Brand Radar integration.

**Content goal** (drives Brand Radar scope):

- `awareness`: Brand Radar is informational only -- understand how AI discusses the topic, do not optimize for Builder.io mentions.
- `acquisition`: Brand Radar is strategic -- analyze how AI assistants position Builder.io vs competitors, identify citation gaps to fill.
- `hybrid`: Brand Radar is targeted -- check if AI assistants mention Builder.io in the topic context, reinforce the connection in the CTA.

### Step 1: Read Inputs

Load from the post output folder:

1. `post.md` -- the SEO-optimized draft
2. `outline.md` -- original heading structure and answer-first block plans
3. `phases/02-keyword-research.yaml` -- primary keyword, question keywords
4. `phases/01-topic-validation.yaml` -- content goal, content timing
5. `phases/03-serp-analysis.yaml` -- PAA questions (if available)
6. `phases/08-seo-optimization.yaml` -- word count after SEO phase
7. `seed/ai-search.txt` (if it exists) -- AI search queries and raw facts from SurferSEO

### Step 2: Heading Compliance Audit

Verify that H2 headings follow AEO question-based heading patterns from [heading-transformation-patterns.md](./references/heading-transformation-patterns.md).

**Checklist for each H2:**

| Check                | Target                                                           | Action if Failed                                       |
| -------------------- | ---------------------------------------------------------------- | ------------------------------------------------------ |
| Question form        | 60-80% of body H2s are questions                                 | Transform declarative headings using the 7 patterns    |
| Character length     | 40-70 chars ideal, 80 max                                        | Tighten with techniques from reference file            |
| Pattern variety      | At least 3 different question patterns per post                  | Replace duplicate patterns with alternatives           |
| Primary keyword      | Present in at least 2 H2 headings                                | Add keyword naturally or use a close variation         |
| Specificity enhancer | At least 2 headings have an enhancer (user type, tool, use case) | Add 1 enhancer to the most generic headings            |
| Structural headings  | Prerequisites, TL;DR, FAQ, Conclusion left as-is                 | Revert any incorrectly transformed structural headings |

**Process:**

1. List all H2 headings from `post.md`.
2. For each, record: question form (yes/no), character count, pattern type (#1-7 or declarative), has specificity enhancer (yes/no).
3. Score against the checklist. If any check fails, apply the minimum fix.
4. Compare with `outline.md` headings. If Phase 6/7/8 drifted from the outline's AEO headings, evaluate whether the drift improved or degraded the heading. Keep improvements; revert degradations.

### Step 3: Answer-First Block Verification

Verify that every H2 body section opens with an answer-first block -- a 40-60 word direct answer to the heading question that an AI assistant could extract verbatim.

**Verification checklist for each answer-first block:**

| Check               | Requirement                                               | Fix                                                                        |
| ------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------- |
| Exists              | Block is present as the first paragraph after the H2      | Write one using the heading question as the prompt                         |
| Length              | 40-60 words                                               | Trim if over 60, expand if under 40                                        |
| Self-contained      | Reads coherently without preceding or following context   | Remove pronouns that reference earlier content ("this", "it", "the above") |
| Specific            | Contains concrete details (tool names, numbers, versions) | Replace vague language with specifics from the section body                |
| Answers the heading | Directly responds to the question in the H2               | Rewrite to match the heading's question                                    |

**Process:**

1. For each H2 section, extract the first paragraph.
2. Check against the table above.
3. If a block is missing, write one. Draw from the section's key insight.
4. If a block exists but fails checks, revise in place.

Sections with declarative headings (Prerequisites, FAQ, Conclusion) do not need answer-first blocks.

### Step 4: Quote-Ready Block Audit

Beyond answer-first blocks, each H2 section should contain at least one additional quote-ready block -- a self-contained element that AI assistants can extract and cite.

**Quote-ready block types:**

| Type             | Format                                           | Best For                     |
| ---------------- | ------------------------------------------------ | ---------------------------- |
| Definition block | 40-60 word paragraph                             | Concept sections             |
| Step list        | Numbered list with action-verb items             | Tutorial sections            |
| Comparison table | 3+ row table with clear headers                  | Versus sections              |
| Code snippet     | Complete, runnable code with language identifier | Implementation sections      |
| Key insight      | Bold sentence with supporting detail             | Trade-off and "Why" sections |

**Audit process:**

1. Scan each H2 section for quote-ready blocks beyond the answer-first block.
2. Count: total quote-ready blocks across the post.
3. If a section has zero quote-ready blocks (only the answer-first block), identify the best candidate from the section's content and restructure it.
4. Test each block against the 5 criteria: self-contained, specific, concise (under 80 words), factually complete (no dangling pronouns), structured.

Minimum target: 1 quote-ready block per H2 section (the answer-first block counts). Aim for 2 per section in longer posts.

### Step 5: Specificity Enhancer Refinement

Review headings that already have specificity enhancers and refine those that are too generic.

**3 enhancer types:**

1. **Target user/team type** -- "for frontend developers", "for marketing teams"
2. **Tool/integration context** -- "in Next.js 15", "with React and TypeScript"
3. **Use case/scenario** -- "for e-commerce pages", "in large-scale apps"

**Refinement process:**

1. List headings with enhancers. Check that the enhancer matches the post's actual audience and tools discussed.
2. List headings without enhancers. For the 2-3 most generic headings, add an enhancer that reflects the post content.
3. Verify no heading exceeds 80 characters after adding enhancers. If it does, choose a shorter enhancer or remove filler words.
4. Do not add enhancers to structural headings (FAQ, Conclusion, Prerequisites).

### Step 6: Brand Radar Integration (Ahrefs)

Use Ahrefs Brand Radar tools to understand how AI assistants currently discuss Builder.io and the post's topic. This informs whether the post fills a citation gap.

**Skip this step entirely if `content_timing: trending`.** Brand Radar data will not exist for new topics.

**Tools to call:**

1. **`brand-radar-ai-responses`** -- Find questions AI assistants answer about the topic where Builder.io is mentioned (or not mentioned).

   ```
   select: query, response, data_source, search_volume
   data_source: chatgpt
   brand: builder.io
   where: query contains "[primary keyword or topic]"
   limit: 10
   ```

   Repeat with `data_source: perplexity` if available.

2. **`brand-radar-cited-pages`** -- Find which Builder.io pages are cited in AI responses for the topic.

   ```
   select: url, responses_brand, search_volume
   data_source: chatgpt
   brand: builder.io
   where: url contains "builder.io"
   limit: 10
   ```

3. **`brand-radar-cited-domains`** -- Find which competitor domains are cited most for the topic.

   ```
   select: domain, responses_total, search_volume
   data_source: chatgpt
   brand: builder.io
   limit: 10
   ```

**How to use the data:**

| Data Point                                                     | Action                                                                                                                      |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| AI assistants answer topic questions but don't cite Builder.io | This post fills a citation gap. Strengthen quote-ready blocks with Builder.io-specific examples.                            |
| Builder.io is already cited for this topic                     | Reinforce existing citations. Ensure the new post's answer-first blocks are more specific than the currently cited content. |
| Competitor domains dominate citations                          | Study what format the competitor content uses (list? table? code?). Mirror the format in quote-ready blocks.                |
| No AI responses exist for this topic                           | New territory. Focus on being the first authoritative source. Maximize quote-ready blocks.                                  |

**Content goal adjustments:**

- `awareness`: Record findings but do not change the post to force Builder.io mentions. The data informs strategy, not this post.
- `acquisition`: Use findings to strengthen Builder.io-specific quote-ready blocks. If competitors dominate, add differentiation in answer-first blocks.
- `hybrid`: Use findings to refine the light CTA. If AI assistants already associate Builder.io with this topic, the CTA can be bolder.

### Step 7: PAA Integration Check

Verify that People Also Ask questions from SERP analysis are addressed in the post, either as H2 headings or in the FAQ section.

**Process:**

1. Read PAA questions from `phases/03-serp-analysis.yaml` (field: `paa_questions`).
2. For each PAA question, check if it is:
   - Used as an H2 heading (best -- direct AEO match)
   - Answered in the FAQ section (good -- FAQ schema markup helps)
   - Answered implicitly in a body section (acceptable -- note which section)
   - Not addressed at all (gap -- add to FAQ section if it strengthens the post)
3. Record the mapping in the output.

If `phases/03-serp-analysis.yaml` has `skipped: true` (trending topic), check for question keywords from `phases/02-keyword-research.yaml` instead. These serve the same purpose.

### Step 7.5: AI Search Coverage Verification

If `seed/ai-search.txt` exists, verify the post covers both the AI search queries and the raw facts.

**AI search queries:**

1. Read the queries from the file (the section before "Raw facts").
2. For each query, verify it is answered by an H2 heading or FAQ entry. The outline (Phase 5) should have mapped these. Confirm the draft followed through.
3. If a query is not covered, add it as an FAQ entry with a 40-60 word answer-first block.

**Raw facts:**

1. Read the raw facts (the section after "Raw facts SurferSEO found from various articles").
2. For each fact, check if the post covers the same topic with equal or better information.
3. Facts the post already covers well: no action needed.
4. Facts the post covers but with less specificity: strengthen the relevant quote-ready block with more concrete details.
5. Facts the post does not address at all: flag as a coverage gap. Add the topic to an existing section if it fits, or note it in the output YAML for the author to decide.

Do not copy competitor facts verbatim. The goal is to ensure the post is at least as comprehensive as what AI engines are currently citing, with better and more current information.

Record results in the output YAML under `ai_search_coverage`.

If `seed/ai-search.txt` does not exist, skip this step.

### Step 8: Word Count Check

Count words in `post.md` after all AEO modifications. See [word-count-guidance.md](../../shared/word-count-guidance.md) for the full word count logic. AEO is the one phase where slightly exceeding the target is acceptable.

**Rules:**

- Record `word_count_before` (from Phase 8) and `word_count_after` in the output YAML.
- AEO optimization primarily restructures existing content. Typical additions are small (answer-first block rewrites, specificity enhancer words in headings, quote-ready block restructuring).
- If slightly over the competitive target (within the Phase 8-9 buffer of 3-5%): note in the output but do not trim AEO improvements. Well-structured quote-ready blocks are worth more than hitting the number exactly.
- If 500+ words over the target: flag as a problem. AEO should not be adding that many words -- something was missed in earlier phases.
- Update `word_count` in `post.md` frontmatter.

### Step 9: Write Output Artifacts

Update `post.md` frontmatter:

```yaml
word_count: [updated count]
status: aeo-optimized
```

Write `phases/09-aeo-optimization.yaml`:

```yaml
question_headings_count: 4
question_headings_total: 6 # total H2s in the post
question_heading_ratio: 0.67
answer_first_blocks: 4 # count of verified answer-first blocks
answer_first_blocks_missing: 0
quote_ready_blocks_total: 9 # total across all sections
heading_character_lengths: [52, 48, 61, 55] # question headings only
headings_over_80_chars: 0
specificity_enhancers_count: 3
pattern_variety: ["What is", "How do", "When should", "Why is"] # distinct patterns used
patterns_used_count: 4
paa_questions_addressed:
  as_heading: ["How do RSC work?"]
  in_faq: ["RSC vs SSR?", "Do RSC replace client components?"]
  in_body: []
  not_addressed: []
structured_answer_formats:
  ["definition", "steps", "comparison table", "code snippet"]
ai_search_coverage:
  status: completed # or "skipped -- no seed file"
  queries_total: 5
  queries_covered_as_heading: 3
  queries_covered_in_faq: 2
  queries_not_covered: 0
  raw_facts_total: 20
  raw_facts_covered_well: 16
  raw_facts_strengthened: 3
  raw_facts_not_addressed: 1
  gaps_flagged: ["team governance features"]
brand_radar:
  status: completed # or "skipped -- trending topic" or "skipped -- awareness goal"
  builder_cited: true # whether Builder.io is currently cited for this topic
  competitor_domains_top3: ["vercel.com", "nextjs.org", "reactjs.org"]
  citation_gap_identified: true
  action_taken: "Strengthened RSC implementation section with Builder.io SDK example"
word_count_before: 2210
word_count_after: 2230
content_goal: awareness # from Phase 1
content_timing: evergreen # from Phase 1
status: aeo-optimized
```

## Trending Topic Mode

When `content_timing: trending`, AEO optimization is MORE important than for evergreen content. AI assistants will be among the first to answer questions about new announcements, so being citable from day one is high-value.

### What Changes

1. **Step 6 (Brand Radar Integration):** Skip entirely. Brand Radar data will not exist for novel topics. Output: `brand_radar: { status: "skipped -- trending topic" }`.
2. **Step 7 (PAA Integration Check):** Use question keywords from `phases/02-keyword-research.yaml` instead of PAA questions from SERP analysis. Social-signal-derived questions from Phase 4 (HN/X discussions) are equally valid.

### What Stays the Same (Full Strength)

- Step 2 (Heading Compliance Audit) -- question headings are essential for AI citation of new topics
- Step 3 (Answer-First Block Verification) -- being the first definitive answer is the entire value proposition for trending content
- Step 4 (Quote-Ready Block Audit) -- AI assistants extracting your content verbatim for a new topic is the highest-value outcome
- Step 5 (Specificity Enhancer Refinement) -- narrow headings differentiate from other early coverage
- Step 8 (Word Count Check) -- word count target still applies, slight overages acceptable
- Step 9 (Output Artifacts) -- same format

### Trending Output Note

Add to `phases/09-aeo-optimization.yaml`:

```yaml
brand_radar:
  status: "skipped -- trending topic"
  note: "Brand Radar data unavailable for new topics. Re-evaluate with /content-compound in 2-4 weeks."
```

## Examples

### Example 1: Heading Compliance Fix

**Before (Phase 8 output):**

```markdown
## Server Component Architecture

## Data Fetching in Server Components

## When to Use Server Components

## Migration Guide

## FAQ
```

**Audit results:**

- "Server Component Architecture" -- declarative, no question form, no enhancer (54 chars)
- "Data Fetching in Server Components" -- declarative, no question form (35 chars, too short)
- "When to Use Server Components" -- question-adjacent but not a question (30 chars, too short)
- "Migration Guide" -- structural, acceptable as-is
- "FAQ" -- structural, keep as-is

**After (Phase 9 fixes):**

```markdown
## How Do React Server Components Work Under the Hood? (53 chars, pattern #2, keyword)

## How Do Server Components Fetch Data in Next.js 15? (53 chars, pattern #2 + tool enhancer)

## When Should You Migrate to Server Components for Data-Heavy Apps? (67 chars, pattern #5 + use case enhancer)

## Migration Guide (keep as-is -- structural)

## FAQ (keep as-is -- structural)
```

**Improvements:** 3/5 headings now question-based (60%), 3 different patterns used (#2, #2, #5 -- note: #2 repeats, acceptable when natural), 2 enhancers added, primary keyword in 2 headings.

### Example 2: Answer-First Block Fix

**H2:** What Are the Benefits of Server Components for React Teams?

**Before (missing answer-first block):**

```markdown
## What Are the Benefits of Server Components for React Teams?

Server Components were introduced in React 18 and have evolved significantly.
The React team has been working on this feature for several years. Let's look
at the main advantages.

1. Reduced bundle size...
```

**After (answer-first block added):**

```markdown
## What Are the Benefits of Server Components for React Teams?

React Server Components reduce client JavaScript by rendering data-dependent
components on the server. Teams see smaller bundles, faster page loads, and
simpler data fetching -- components read from databases directly without
useEffect or client-side state management. (42 words)

Here's how each benefit works in practice:

1. Reduced bundle size...
```

The new block is self-contained, specific, answers the heading directly, and can be extracted by an AI assistant without context.

### Example 3: Brand Radar Informing Strategy

**Topic:** Headless CMS comparison
**Content goal:** `acquisition`
**Brand Radar findings:**

- `brand-radar-ai-responses`: ChatGPT mentions Builder.io in 3 of 12 headless CMS queries, but only for "visual editing" -- not for "developer experience" or "performance."
- `brand-radar-cited-pages`: The Builder.io blog post `/blog/headless-cms-guide` is cited twice.
- `brand-radar-cited-domains`: Contentful (cited 8 times), Sanity (cited 6 times), Builder.io (cited 3 times).

**Action:** Strengthen the quote-ready blocks in the developer experience section with Builder.io-specific code examples. Add a comparison table in the performance section showing Builder.io's edge-cached delivery times. This fills the citation gaps in "developer experience" and "performance" queries.

### Example 4: Trending Topic AEO

**Topic:** New React compiler (just announced)
**Content timing:** `trending`

**Step 0:** Trending mode activated. All heading/block techniques at full strength. Brand Radar skipped.

**Step 2 results:** 4 of 5 body headings are question-based (80%). Pattern variety: What is, How does, When should, What are the. No fixes needed.

**Step 3 results:** All 4 question headings have answer-first blocks. One is 72 words (too long) -- trimmed to 58.

**Step 4 results:** 7 quote-ready blocks total. Two code snippets serve as quote-ready blocks. Section "What Are the Limitations?" has no quote-ready block beyond the answer-first -- added a 3-row comparison table of limitations.

**Step 6:** Skipped (trending). Output: `brand_radar: { status: "skipped -- trending topic" }`.

**Step 7:** Used question keywords from Phase 2 instead of PAA. 2 of 3 addressed as headings, 1 in FAQ.

## Guidelines

- AEO optimization restructures; it does not rewrite. If Phase 5 did its job, most headings are already question-based. Phase 9 catches drift and refines.
- Answer-first blocks are the highest-value AEO element. Every H2 body section must have one. This is non-negotiable.
- Quote-ready blocks are the second highest-value element. A section without a single extractable block is invisible to AI assistants.
- Do not transform every heading into a question. 60-80% question headings is the target. Structural headings, code walkthroughs, and transitional sections are fine as declarative.
- Specificity enhancers make headings unique. "What Is a Headless CMS?" competes with thousands of articles. "What Is a Headless CMS for React Teams Building Multi-Brand Sites?" competes with far fewer.
- Brand Radar data is strategic intelligence, not a mandate. It informs where citation gaps exist. For awareness posts, record the data but do not change the post to force Builder.io mentions.
- Trending topics are the highest-ROI AEO opportunity. Being the first authoritative, well-structured answer for a new topic establishes citation dominance before competitors publish.
- Keep modifications focused. AEO optimization typically adds only a few words (heading rewrites, answer-first block refinements, quote-ready block restructuring). Slightly exceeding the word count target is acceptable if the additions improve citability -- do not sacrifice AEO quality to hit the number exactly.
