---
name: outline-creation
description: "This skill should be used when structuring a blog post based on research findings. It covers title scoring, AEO question-based headings, answer-first blocks, featured snippet targeting, copywriting framework selection, hook planning, word count budgeting, and post-type-specific templates. Integrates content goal routing for Builder.io mentions."
---

# Outline Creation

Structure a blog post into a publish-ready outline based on research from Phases 1-4. The outline determines heading hierarchy, AEO question headings, featured snippet targets, word count distribution, and the narrative arc. This is the last planning artifact before drafting begins.

## When to Use This Skill

- After Content Research (Phase 4) has completed
- When the `/content-blog`, `/content-research`, or `/content-refresh` orchestrator skill reaches the outline phase

## Prerequisites

- Topic validation in `phases/01-topic-validation.yaml`
- Keywords in `phases/02-keyword-research.yaml`
- SERP analysis in `phases/03-serp-analysis.yaml` (may be `skipped: true` for trending topics)
- Content research in `phases/04-content-research.yaml` and `research-notes.md`

## Process

### Step 0: Check Content Timing and Content Goal

Read `content_timing` and `content_goal` from `phases/01-topic-validation.yaml`.

**Content timing:**
- If `content_timing: trending`: See the Trending Topic Mode section below for adjustments.
- If `content_timing: evergreen`: Continue with Step 1 using all available data.

**Content goal** (drives Builder.io section placement):
- `awareness`: No Builder.io section in the outline.
- `acquisition`: Include a Builder.io integration section. Placement depends on `integration_pattern` from Phase 1 output.
- `hybrid`: Include a light CTA section in the outline.

**Page type** (drives structure and linking):

Read `page_type` from `phases/01-topic-validation.yaml`. Values: `standalone` (default), `pillar`, `cluster`.

- `standalone`: Standard outline process. No hub-specific behavior.
- `pillar`: Load [hub-page-outlines.md](./references/hub-page-outlines.md) for pillar-specific templates. Override post type selection in Step 1. Target word count: 3,000-4,000.
- `cluster`: Use standard post type template. Add mandatory pillar backlink in intro (see Step 5). Read `hub_slug` from Phase 1 output to identify the parent hub.

### Step 0.5: Refresh Mode Detection

Check for `refresh-scope.yaml` in the output folder.

**If `refresh-scope.yaml` exists AND `refresh_mode == "selective-rewrite"`:**

Enter refresh outline mode:

1. Load the original outline. If `outline.md` exists, use it. Otherwise, reconstruct from the original post's H2 headings.
2. For each section in `refresh-scope.yaml`:
   - **KEEP:** Preserve heading and word count budget. Mark `[KEEP]`. Do not modify.
   - **REWRITE:** Generate new key points, answer-first block, and word count budget. Mark `[REWRITE]`.
   - **ADD:** Generate full section spec (heading, key points, answer-first block, snippet target, word count). Mark `[ADD]` with `insert_after` position.
3. Place ADD sections at their specified `insert_after` position.
4. Re-validate total word count budget. KEEP word counts are fixed; adjust REWRITE and ADD if total exceeds ceiling.
5. Skip title scoring and hook selection (preserve originals unless user requests changes at Gate 2).
6. Proceed to Step 9 (Assemble Outline) with refresh markers.

**If `refresh-scope.yaml` exists AND `refresh_mode == "full-rewrite"`:**

Proceed normally through Steps 1-9. Use the original post as reference context (structure, voice, angle) but not as a constraint. Generate fresh title candidates. The original title is included as one candidate for comparison.

**If `refresh-scope.yaml` does not exist:** Continue to Step 1 (standard new post mode).

### Step 1: Select Post Type

Determine the post type from the topic, research findings, and search intent. The post type drives the structural template.

| Post Type | Best For | Signal |
|-----------|----------|--------|
| Tutorial | Step-by-step implementation | Search intent is "how to", topic involves building something |
| Comparison | Evaluating alternatives | Topic contains "vs", "alternatives", or "which" |
| Explainer | Conceptual understanding | Search intent is "what is", topic is a concept or technology |
| How-to | Solving a specific problem | Narrow scope, single clear outcome |
| Thought Leadership | Opinion, strategy, prediction | No existing consensus, contrarian angle from research |

Load the matching template from [outline-templates.md](./references/outline-templates.md). The template provides the base structure -- adapt it to the specific topic.

**Pillar page override:** If `page_type == pillar`, skip the post type table above. Load the pillar template from [hub-page-outlines.md](./references/hub-page-outlines.md) instead — select "What Is X?" or "Complete Guide" based on the hub topic's nature (conceptual vs practical). Pillar pages use one H2 section per cluster topic at overview depth (200-300 words each).

### Step 2: Generate Title Candidates

Generate 3-5 title options. Score each using the headline scoring checklist:

| Criterion | Points | Question |
|-----------|--------|----------|
| Clarity | 0-2 | Is the meaning immediately clear? |
| Curiosity | 0-2 | Does it make the reader want to click? |
| Specificity | 0-2 | Does it use concrete numbers, tools, or details? |
| Value | 0-2 | Is the benefit to the reader obvious? |
| Authenticity | 0-2 | Does it avoid clickbait and AI-sounding phrasing? |

**Scoring rules:**
- 7+ out of 10: Publishable.
- 5-6: Needs refinement. Try adding specificity or a clearer benefit.
- Below 5: Rethink the angle.

**Title formulas by post type:**

| Post Type | Formula | Example |
|-----------|---------|---------|
| Tutorial | "How to [X] with [Y]" | "How to Build a Visual CMS with Next.js" |
| Tutorial | "[Number] [Outcome] with [Tool]" | "5 Ways to Speed Up Your React App" |
| Comparison | "[X] vs [Y]: [Specific Angle]" | "Server Components vs Client Components: When to Use Each" |
| Explainer | "What is [X]? [Audience-specific qualifier]" | "What is a Headless CMS? A Frontend Developer's Guide" |
| How-to | "How to [Solve Specific Problem]" | "How to Fix React Hydration Errors in Next.js" |
| Thought Leadership | Contrarian or bold claim | "You Don't Need a JavaScript Framework for That" |

**Specificity rules:** Use exact numbers (not rounded), specific tool names, and non-generic qualifiers. "5 React Performance Tips" is weaker than "5 React Performance Fixes That Cut Our Bundle Size by 40%".

### Step 3: Choose Hook Type

Select the hook type that best fits the topic angle and research findings.

| Hook Type | When to Use | Example |
|-----------|-------------|---------|
| Bold Claim | Strong research backing, surprising conclusion | "React Server Components make 90% of your client-side state management unnecessary." |
| Story Start | Personal experience angle, relatable frustration | "Last week, I spent 3 hours debugging a hydration error that shouldn't have existed." |
| Contrarian | Going against popular opinion, research supports a different view | "Everyone's excited about Server Components, but most tutorials are teaching them wrong." |
| Question | Reader identifies with the problem, curiosity gap | "What if your React components could fetch their own data without useEffect?" |
| Statistic | Hard data available, performance or adoption angle | "Pages using Server Components load 40% faster on average." |
| Problem | Universal pain point, immediate reader recognition | "Every React app eventually hits the 'waterfall problem' -- fetch parent, wait, fetch child, wait." |

Write a specific hook idea (not just the type). The hook should reference actual findings from Phase 4 research.

**For comparison posts:** The hook should frame the decision the reader faces, NOT reveal which option the author recommends. The recommendation belongs in the conclusion -- it's the payoff that keeps readers engaged.

### Step 4: Select Copywriting Framework

Choose the framework based on content goal and post type:

| Framework | Best For | Structure |
|-----------|----------|-----------|
| PAS (Problem-Agitate-Solution) | Acquisition posts, pain-point-driven topics | Problem → Agitate the pain → Solution |
| AIDA (Attention-Interest-Desire-Action) | Product-focused posts, acquisition/hybrid goals | Attention → Interest → Desire → Action |
| Before-After-Bridge | How-to posts, transformation narratives | Painful Before → Ideal After → Bridge (how to get there) |

For pure awareness posts, the framework is lighter -- the post structure itself carries the narrative. Still select one as a guiding principle, but do not force every section into the framework.

### Step 5: Build Section Structure with AEO Headings

This is the core of the outline. Build the H2 section structure using question-based headings for AEO optimization.

**Temporal awareness:** Read the current date before generating headings or section structure.

- Do not append the year to definitional headings ("What Is X?" not "What Is X in 2026?"). The year in the title tag is sufficient for freshness signals.
- If referencing recent releases, use relative framing based on how long ago they shipped:
  - Less than 2 months ago: "recently shipped", "just launched", "the latest release"
  - 2-6 months ago: "earlier this year", "in the [month] release"
  - 6-12 months ago: "in [year]", "over the past year"
- For section headings about features/updates: prefer "What Features Does X Offer?" over "What Did X Ship in [Year]?" unless the post's angle is specifically about the release timeline.

**AEO heading rules:**

1. Transform declarative headings into question form. "Server Component Architecture" becomes "How Do React Server Components Work Under the Hood?"
2. Target 40-70 characters per heading. Maximum 80. Shorter is better for AI citation.
3. Include the primary keyword or a close variation in at least 2 headings.
4. Use specificity enhancers: user type ("for frontend developers"), tool context ("in Next.js 14"), use case ("for large-scale apps").
5. Not every heading needs to be a question. Keep these as-is when appropriate: Prerequisites, Requirements, TL;DR, FAQ.
6. Vary the question pattern. Do not start every heading with "How". Mix "What", "Why", "When", "Which", and "How".

**AI search query integration:**

If a `seed/ai-search.txt` file exists in the post output folder, it contains the top queries people ask AI search engines about this topic (from SurferSEO or similar tools). Each query represents a question the post must answer.

- Map each AI search query to an existing H2 heading, a new H2 heading, or an FAQ entry.
- Prefer making them H2 headings when the query is broad enough to warrant a full section. Use FAQ for narrower questions that are answered in 40-60 words.
- Every AI search query must be covered somewhere in the outline. If a query does not map to any planned section, either add a section or add it to the FAQ.
- Document the mapping in `phases/05-outline-creation.yaml` under `ai_search_query_coverage`.

**Seed keyword heading integration:**

If a `seed/keywords.txt` file exists in the post output folder, it may contain keyword density targets from tools like SurferSEO. Some keywords are recommended for headings.

Cross-reference the AEO heading plan with heading-recommended keywords:
- For each heading keyword, check if it fits naturally into an existing AEO question heading.
- Prefer hybrid headings that satisfy both AEO (question-form) and keyword density (keyword-rich). Example: "Where does the Cursor agent still shine?" is both a question and contains "Cursor agent."
- Do not sacrifice heading clarity or question-form for keyword insertion. If a keyword does not fit naturally, place it in the section body instead.
- Document which heading keywords were incorporated and which were deferred to body text in `phases/05-outline-creation.yaml`.

**For each H2 section, specify:**

- **Heading text** (question-based for AEO where appropriate)
- **Key points** (3-5 bullet points of what this section covers)
- **Answer-first block** (40-60 word direct answer that could be extracted by an LLM as a standalone response)
- **Mermaid diagram** (yes/no -- use for architecture, data flow, comparison, or process visualization)
- **Featured snippet target** (definition / list / table / code / none)
- **Estimated word count** for the section

**Word count budgeting:**

See [word-count-guidance.md](../shared/word-count-guidance.md) for the full word count logic. In summary:

1. **Primary signal:** Use the median word count of the top 5 SERP competitors from `phases/03-serp-analysis.yaml`. Add 10-20% for depth advantage.
2. **SERP quality gate:** If top 5 word counts have high variance (std dev > 50% of median), fall back to the guidance range table.
3. **Fallback (trending or no SERP data):** Use the guidance range for this post type from the shared reference.
4. **User override:** If `max_word_count` is set in `phases/01-topic-validation.yaml`, use it.

Declare the target word count and its source (SERP competitive median, guidance range, or user override) in the outline output. Downstream phases reference it.

Distribute across sections:

| Section | Typical Range |
|---------|--------------|
| Introduction (hook + context) | 150-250 words |
| Each body H2 section | 300-600 words |
| FAQ section (if included) | 150-300 words |
| Conclusion + CTA | 100-200 words |

Use as many body sections as the topic requires (typical: 4-8). If the total significantly exceeds the competitive target, evaluate whether sections should be split into a separate post rather than trimming.

**Hub page word count overrides:**

- `pillar`: Target 3,000-4,000 words. Ignore SERP-based median — pillar pages are structurally longer. Source: `hub_pillar_override`.
- `cluster`: Use standard word count logic (SERP median or guidance range). Typical: 1,500-2,500.

**Cluster page intro requirement:** If `page_type == cluster`, the introduction MUST include a contextual link to the pillar page within the first 2-3 paragraphs. Use the pillar's primary keyword as anchor text. See [hub-page-outlines.md](./references/hub-page-outlines.md) for framing examples.

### Step 6: Plan FAQ Section

Include an FAQ section when PAA (People Also Ask) questions are available from SERP analysis.

**Sources for FAQ questions:**
1. PAA questions from `phases/03-serp-analysis.yaml` (evergreen topics)
2. AI search queries from `seed/ai-search.txt` that were not mapped to H2 headings (see Step 5)
3. Common questions from Hacker News and X/Twitter research (Phase 4)
4. Stack Overflow frequently asked questions (Phase 4)
5. Question-form keywords from `phases/02-keyword-research.yaml`

Select 3-5 questions. For each, write a 40-60 word direct answer in the outline. These become featured snippet candidates.

If no PAA data exists (trending topics), use questions extracted from social discussion in Phase 2 (social signals) and Phase 4 (HN/X questions).

### Step 7: Plan Content Goal Section

Based on `content_goal` from Step 0:

**Acquisition:**
- Read `integration_pattern` from `phases/01-topic-validation.yaml`
- Place the Builder.io section according to the pattern:
  - `product-showcase`: Builder.io is woven throughout (the content demonstrates Builder.io)
  - `before-after`: Dedicated section showing the workflow improvement
  - `honest-comparison`: Section comparing Builder.io with alternatives
  - `problem-solution`: Section leading with pain point, then Builder.io's specific solution
  - `light-cta-only`: Single CTA paragraph at the end
- Note the Builder.io capability being highlighted (`builder_capability` from Phase 1)

**Hybrid:**
- Add a light CTA section to the outline
- The CTA should connect naturally to the post's topic
- Do not add a dedicated Builder.io section in the body

**Awareness:**
- No Builder.io section. The post stands on its own merit.
- CTA in the conclusion is topic-related (e.g., "Star the repo", "Try the tool", "Read the docs")

### Step 8: Write Conclusion Plan

The conclusion should include:

1. **Summary** -- 2-3 sentence recap of the key takeaway (not a section-by-section rehash)
2. **CTA** -- Specific, connected to the post content. Not generic ("Subscribe for more"). Examples:
   - Awareness: "Clone the starter repo and try it yourself"
   - Acquisition: "See how Builder.io handles [specific thing discussed in the post]"
   - Hybrid: "Start with the approach above, and if you need [specific capability], check out Builder.io's [feature]"

### Step 8b: Claims Verification Checklist (Comparison and AI-Tool Posts)

If the post type is `comparison` OR the topic involves AI models, developer tools, or pricing:

Build a "Claims to Verify Before Publish" list. For each product or tool discussed, list every factual claim the outline implies:
- Feature availability (e.g., "Cursor supports subagents")
- Model names and versions (e.g., "uses GPT-5")
- Pricing tiers
- Capability comparisons

Include this list in the outline output. It flows through the pipeline and is verified at Phase 10 (Step 8b: Factual Claims Verification in the post-publish checklist).

**Example for a comparison post (Claude Code vs Cursor):**

```
## Claims to Verify Before Publish
- [ ] Claude Code: current Claude model name and version
- [ ] Claude Code: MCP support scope (CLI vs web)
- [ ] Cursor: subagent support (full or limited)
- [ ] Cursor: model options and current defaults
- [ ] Both: current pricing tiers
```

For non-comparison posts about stable topics, this step is optional.

### Step 9: Assemble the Outline

Write the complete outline to `outline.md` in the post output folder using this format:

```markdown
# Title Candidates

## Option 1: [Title] (Score: X/10)
- Clarity: X/2 | Curiosity: X/2 | Specificity: X/2 | Value: X/2 | Authenticity: X/2

## Option 2: [Title] (Score: X/10)
- Clarity: X/2 | Curiosity: X/2 | Specificity: X/2 | Value: X/2 | Authenticity: X/2

## Option 3: [Title] (Score: X/10)
- Clarity: X/2 | Curiosity: X/2 | Specificity: X/2 | Value: X/2 | Authenticity: X/2

---

**Post type:** [tutorial | comparison | explainer | how-to | thought-leadership]
**Page type:** [standalone | pillar | cluster]
**Copywriting framework:** [PAS | AIDA | Before-After-Bridge]
**Content goal:** [awareness | acquisition | hybrid]
**Target word count:** ~[competitive median + 10-20% or guidance range]

---

## Introduction (~200 words)
- **Hook type:** [Bold Claim | Story | Contrarian | Question | Statistic | Problem]
- **Hook:** [Specific hook idea referencing research findings]
- **Context:** [What problem this solves, why the reader should care]
- **Thesis:** [1-sentence promise of what the reader will learn]

## [Question-Based H2 Heading] (~400 words)
- Key point 1
- Key point 2
- Key point 3
- **Answer-first block:** [40-60 word direct answer]
- **Mermaid diagram:** yes/no
- **Featured snippet target:** definition/list/table/code/none

## [Question-Based H2 Heading] (~400 words)
- Key point 1
- Key point 2
- Key point 3
- **Answer-first block:** [40-60 word direct answer]
- **Mermaid diagram:** yes/no
- **Featured snippet target:** list/none

[... additional H2 sections ...]

## FAQ (~200 words)
- **Q: [Question]?** → [40-60 word answer]
- **Q: [Question]?** → [40-60 word answer]
- **Q: [Question]?** → [40-60 word answer]

## Conclusion (~150 words)
- **Summary:** [Key takeaway in 2-3 sentences]
- **CTA:** [Specific, content-connected call to action]

---

**Estimated total:** ~2200 words
**Primary keyword placement:** [title, H2-1, H2-3, intro, conclusion]
**Secondary keywords:** [keyword] in [H2-2], [keyword] in [FAQ]
```

### Refresh Outline Format (Step 0.5)

When in refresh outline mode, prefix each H2 heading with `[KEEP]`, `[REWRITE]`, or `[ADD]`:

```markdown
# Refresh Outline

**Original title:** [preserved title]
**Refresh mode:** selective-rewrite

---

## [KEEP] What Are React Server Components? (~400 words)
- [locked -- content preserved from original]

## [REWRITE] How to Build Your First Server Component (~500 words)
- Key point 1 (updated)
- **Answer-first block:** [new 40-60 word answer]
- **Featured snippet target:** code

## [ADD] How Do Server Components Handle Streaming? (~350 words)
- Key point 1
- **Answer-first block:** [40-60 word answer]
- **Insert after:** "How to Build Your First Server Component"

---

**Sections:** N KEEP, N REWRITE, N ADD
**Estimated total:** ~XXXX words
```

## Output Schema

Write `phases/05-outline-creation.yaml`:

```yaml
post_type: tutorial | comparison | explainer | how-to | thought-leadership
page_type: standalone | pillar | cluster  # from phases/01-topic-validation.yaml
title_candidates:
  - title: "Title text"
    score: 8
    breakdown: "Clarity: 2 | Curiosity: 2 | Specificity: 1 | Value: 2 | Authenticity: 1"
  - title: "Title text"
    score: 7
    breakdown: "Clarity: 2 | Curiosity: 1 | Specificity: 2 | Value: 1 | Authenticity: 1"
  - title: "Title text"
    score: 7
    breakdown: "Clarity: 1 | Curiosity: 2 | Specificity: 1 | Value: 2 | Authenticity: 1"
hook_type: "Bold Claim"
copywriting_framework: PAS
content_goal: awareness | acquisition | hybrid
builder_section: none | product-showcase | before-after | comparison | problem-solution | light-cta-only
sections_count: 6
question_headings_count: 4
answer_first_blocks_count: 4
faq_questions_count: 3
mermaid_diagrams_planned: 1
featured_snippet_targets:
  - section: "H2-1"
    type: definition
  - section: "FAQ"
    type: list
word_count_budget:
  introduction: 200
  body_sections: 1600
  faq: 200
  conclusion: 150
  total: 2150
primary_keyword_placements:
  - title
  - h2_1
  - h2_3
  - introduction
  - conclusion
ai_search_query_coverage:
  - query: "Pricing Comparison of Claude Code and Cursor"
    mapped_to: "H2: How much do Claude Code and Cursor cost in 2026?"
  - query: "When to Use Claude Code vs Cursor"
    mapped_to: "FAQ"
seed_heading_keywords:
  incorporated: []    # keywords added to headings from seed/keywords.txt
  deferred_to_body: [] # keywords that didn't fit headings naturally
word_count_target: 2150  # from SERP competitive median, guidance range, or user override
word_count_source: serp_competitive_median  # serp_competitive_median | guidance_range | user_override
word_count_serp_median: 2000  # median of top 5 competitors (null if no SERP data)
```

Also write `outline.md` in the post output folder using the format from Step 9.

## Trending Topic Mode

When `content_timing: trending`, the outline still follows the same structure with these adjustments:

### What Changes

1. **FAQ section:** PAA questions from SERP Analysis will not exist. Substitute with:
   - Questions extracted from social signals in Phase 2 (`question_keywords`)
   - Early HN/X questions discovered in Phase 4
   - Questions the author anticipates based on the topic angle
2. **Featured snippet targets:** No SERP baseline exists. Mark featured snippet targets as "best-effort -- revisit post-publish" or skip them.
3. **Keyword placement:** Use social-signal-derived keywords from Phase 2 instead of traditional keyword data.

### What Stays the Same

Title scoring, AEO headings, answer-first blocks, post type, hook type, copywriting framework, word count budgeting, and content goal routing all remain unchanged.

### Trending Note

Add to the outline metadata when `content_timing: trending`:

```
**Note:** SEO-specific structures are best-effort. Refine post-publish via `/content-compound`.
```

## Examples

### Example 1: Evergreen Tutorial Outline

**Topic:** "React Server Components"
**Content timing:** `evergreen`
**Content goal:** `awareness`
**Post type:** `tutorial`

**Title candidates:**
1. "How React Server Components Actually Work: A Practical Guide" (Score: 8/10 -- Clarity: 2, Curiosity: 2, Specificity: 1, Value: 2, Authenticity: 1)
2. "React Server Components in 2026: What Every Frontend Dev Needs to Know" (Score: 7/10)
3. "Building Your First React Server Component: From Zero to Production" (Score: 8/10)

**Hook type:** Problem
**Hook:** "Every React app eventually hits the waterfall problem -- fetch parent, wait, fetch child, wait, render. Server Components break that cycle."
**Copywriting framework:** Before-After-Bridge

**Sections:**
- Introduction: Problem hook + context (~200 words)
- "What Are React Server Components and Why Do They Matter?" (~400 words) -- answer-first block, definition snippet target
- "How Do Server Components Differ from Client Components?" (~350 words) -- comparison table, mermaid diagram of render flow
- "How to Build Your First Server Component in Next.js" (~500 words) -- code snippet target, step-by-step
- "What Are the Common Gotchas When Migrating to Server Components?" (~350 words) -- list snippet target, SO-sourced gotchas
- FAQ: 3 questions from PAA (~200 words)
- Conclusion + CTA: "Clone the starter repo" (~150 words)

**Total:** ~2150 words

### Example 2: Trending Explainer Outline

**Topic:** "Claude 4.5 Extended Thinking"
**Content timing:** `trending`
**Content goal:** `hybrid`

**Title candidates:**
1. "Claude 4.5's Extended Thinking: What It Is and How to Use It in Your Apps" (Score: 8/10)
2. "Extended Thinking in Claude 4.5: A Developer's First Look" (Score: 7/10)
3. "How Claude 4.5's Extended Thinking Changes AI-Assisted Coding" (Score: 7/10)

**Hook type:** Bold Claim
**Hook:** "Extended thinking isn't chain-of-thought with a fancy name. It's the first time an LLM can genuinely pause to reason before answering -- and the API integration is surprisingly simple."
**Copywriting framework:** PAS

**Sections:**
- Introduction: Bold claim + context (~200 words)
- "What Is Extended Thinking in Claude 4.5?" (~400 words) -- answer-first block, definition snippet (best-effort)
- "How Does Extended Thinking Compare to Chain-of-Thought Prompting?" (~350 words) -- comparison, HN-sourced debate
- "How to Integrate Extended Thinking via the Anthropic API" (~500 words) -- code examples from official docs
- "When Should You Use Extended Thinking vs Standard Mode?" (~300 words) -- decision framework
- FAQ: 3 questions from HN/X discussion (~200 words)
- Conclusion + CTA: "Try the approach above, and if you need a visual interface for testing prompts, check out Builder.io's AI playground" (~150 words)

**Total:** ~2100 words
**Note:** SEO-specific structures are best-effort. Revisit post-publish once SERP data populates.

### Example 3: Acquisition Comparison Outline

**Topic:** "Headless CMS Comparison"
**Content timing:** `evergreen`
**Content goal:** `acquisition`
**Integration pattern:** `honest-comparison`

**Title candidates:**
1. "Headless CMS in 2026: Contentful vs Sanity vs Builder.io for React Teams" (Score: 8/10)
2. "Which Headless CMS Should You Choose? A Real-World Comparison" (Score: 7/10)
3. "Headless CMS Showdown: What 50+ GitHub Discussions Reveal" (Score: 7/10)

**Hook type:** Question
**Hook:** "Your team just decided to go headless. Now you're staring at 30+ CMS options and every comparison article reads like sponsored content. Here's an honest one."
**Copywriting framework:** AIDA

**Sections:**
- Introduction: Question hook + honesty pledge (~200 words)
- "What Makes a CMS 'Headless' and Why Does It Matter for React?" (~300 words) -- answer-first block, definition snippet
- "How Do Contentful, Sanity, and Builder.io Compare on Developer Experience?" (~500 words) -- comparison table, code examples from each
- "Which CMS Handles Visual Editing Best for Non-Technical Teams?" (~400 words) -- Builder.io section (honest-comparison pattern), before/after workflow
- "What Are the Real Costs Beyond the Pricing Page?" (~350 words) -- pricing comparison, hidden costs
- FAQ: 4 PAA questions (~250 words)
- Conclusion + CTA: specific Builder.io trial link for the use case discussed (~150 words)

**Total:** ~2150 words

## Guidelines

- Always start from the post type template in [outline-templates.md](./references/outline-templates.md) and adapt, rather than building from scratch.
- The title scoring gate matters. Do not proceed with a title scoring below 7. Generate more candidates until at least one scores 7+.
- AEO headings are drafted here, not in Phase 9. Phase 9 is a verification and refinement pass only.
- The answer-first block is the single most important AEO element. Every H2 should have a 40-60 word self-contained answer that an LLM could extract verbatim.
- Word count budget is a guide, not a constraint. Sections naturally vary. The total should land within the competitive range from SERP analysis (or the guidance range if no SERP data). AEO optimization (Phase 9) may push slightly past the target -- that is acceptable.
- Featured snippet targets are aspirational for trending topics. Do not spend time optimizing snippet format when no SERP data exists.
- The outline is presented at Gate 2 in the `/content-blog` pipeline. The user can approve, modify, or regenerate. Design the outline for easy modification -- clear sections with clear purposes.
- Mermaid diagrams add visual value but increase word count. Limit to 1-2 per post. Use for architecture, data flow, comparison matrices, or decision trees.
- When adapting for modification requests (Gate 2 "Modify outline" flow), re-run from Step 5 onward with the original research plus modification instructions. Do not re-score titles unless specifically asked.
- In refresh mode, KEEP sections are locked. Do not modify their headings or word count budgets. Only REWRITE and ADD sections get fresh outline treatment.
- Refresh mode is backward-compatible. New posts never have a `refresh-scope.yaml` file, so Step 0.5 is skipped entirely for standard blog creation.
