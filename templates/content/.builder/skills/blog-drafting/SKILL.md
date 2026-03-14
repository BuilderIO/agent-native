---
name: blog-drafting
description: "This skill should be used when writing a first draft from an approved outline. It covers hook execution, paragraph structure, code example formatting, natural Builder.io integration patterns, CTA patterns by content goal, and anti-patterns to avoid. Delegates voice and tone to the Style Guide skill."
---

# Blog Drafting

Write a first draft of a blog post from an approved outline and research artifacts. The draft follows the outline's structure, word count budget, and content goal routing. Voice and tone rules come from the Style Guide skill -- this skill handles structure, patterns, and anti-patterns.

## When to Use This Skill

- After the outline (Phase 5) has been approved at Gate 2
- When the `/content-blog`, `/content-lfg`, or `/content-refresh` orchestrator skill reaches the drafting phase
- When rewriting a draft after "Request changes" at Gate 3

## Prerequisites

- Approved outline in `outline.md` (from Phase 5)
- Topic validation in `phases/01-topic-validation.yaml`
- Keywords in `phases/02-keyword-research.yaml`
- SERP analysis in `phases/03-serp-analysis.yaml` (may be `skipped: true` for trending topics)
- Content research in `phases/04-content-research.yaml` and `research-notes.md`
- Outline metadata in `phases/05-outline-creation.yaml`
- Spec analysis in `phases/05.5-content-spec-analysis.yaml` (optional -- may not exist for pre-5.5 pipelines or skipped phases)

## Process

### Step 0: Check Content Timing and Content Goal

Read `content_timing` and `content_goal` from `phases/01-topic-validation.yaml`.

**Content timing:**
- If `content_timing: trending`: See the Trending Topic Mode section below for adjustments.
- If `content_timing: evergreen`: Continue with Step 1 using all available data.

**Content goal** (drives Builder.io integration):
- `awareness`: No promotional Builder.io mentions (product pitches, dedicated sections, CTAs). The post stands on its own. Internal links to related Builder.io blog posts are fine -- they are subtle and help SEO.
- `acquisition`: Read `integration_pattern` and `builder_capability` from Phase 1 output. If the `builder-product-knowledge` skill has been loaded, use it to write the product section. If it has not been loaded, do not mention Builder.io.
- `hybrid`: Include a light CTA connecting the topic to Builder.io. No Builder.io mentions in the body.

### Step 0.5: Refresh Mode Detection

Check for `refresh-scope.yaml` in the output folder.

**If `refresh-scope.yaml` exists AND `refresh_mode == "selective-rewrite"`:**

Enter refresh drafting mode. Read the original post content (from fetched seed URL content or existing `post.md`).

For each section in the outline:
- **[KEEP]:** Copy the section verbatim from the original post. Do not modify content. Exception: transition sentences at section boundaries may be lightly edited for flow with adjacent REWRITE/ADD sections.
- **[REWRITE]:** Draft the section fresh using current research. Follow standard Step 3 rules. Reference the original section's approach to maintain voice consistency.
- **[ADD]:** Draft the section fresh. Follow standard Step 3 rules. Write transition sentences that connect naturally to surrounding sections.

After assembly, run a flow pass: read the full post and smooth transitions between KEEP and REWRITE/ADD sections. Do not modify KEEP section content beyond boundary transitions.

Proceed to Step 10 (Assemble Draft).

**If `refresh-scope.yaml` exists AND `refresh_mode == "full-rewrite"`:**

Proceed normally through Steps 1-10. Use the original post as voice/tone reference (not content constraint).

**If `refresh-scope.yaml` does not exist:** Continue to Step 1 (standard new post mode).

### Step 1: Read All Inputs

Load these files from the post output folder:

1. `outline.md` -- the approved structure, section headings, word count budgets, hook type, copywriting framework, title selection
2. `research-notes.md` -- narrative research findings, source quotes, data points
3. `phases/04-content-research.yaml` -- synthesis matrix, source list, content gaps identified
4. `phases/02-keyword-research.yaml` -- primary keyword, secondary keywords, semantic keywords
5. `phases/05-outline-creation.yaml` -- metadata (post type, hook type, framework, snippet targets)
6. `seed/keywords.txt` (if it exists) -- keyword density targets from SurferSEO or similar tools
7. `seed/ai-search.txt` (if it exists) -- two types of data from SurferSEO:
   - **AI search queries:** The top questions people ask AI engines about this topic. The outline maps each query to a heading or FAQ entry. Ensure those sections answer the queries thoroughly.
   - **Raw facts:** Factual statements AI engines currently extract and cite from competitor articles. Treat these as supplementary research. The draft should cover the same topics with better, more current information. Do not copy competitor facts verbatim -- write original content that addresses the same user needs.

The outline is the authoritative structure. Do not deviate from its section order, heading text, or word count budget unless a section clearly needs adjustment during writing.

### Step 1.5: Check Seed Keyword Density Targets

If `seed/keywords.txt` exists, parse it for keyword density targets. These come from tools like SurferSEO and specify how many times each keyword should appear in the draft based on competitor analysis.

1. Read the file and extract keywords with their target ranges (e.g., "cursor agent 7/5-10" means the SurferSEO article uses it 7 times and the target range is 5-10).
2. Cross-reference with the primary and secondary keywords from Phase 2. The seed targets supplement (not replace) the keyword placement rules in Step 9.
3. Note any keywords where the target count is high relative to the word count budget. These keywords need to be distributed across multiple sections rather than clustered in one.
4. If seed targets suggest the draft needs more words to hit density naturally (e.g., 80+ keyword phrases across a 2,500-word budget), flag this. The word count ceiling from the outline should already account for competitive range (see outline-creation skill), but verify alignment.

If `seed/keywords.txt` does not exist, skip this step.

### Step 1.7: Review Verification Checklist

If `phases/05.5-content-spec-analysis.yaml` exists, read the `verification_checklist` array. Each item contains:
- `claim`: a factual statement that needs verification
- `section`: the heading where this claim appears
- `method`: suggested verification approach (WebSearch or WebFetch URL)
- `verified`: false (not yet verified)

Hold these claims in context. When writing the relevant section (Step 3), attempt to verify each claim using the suggested method. Record results in the output YAML under `spec_checklist_results`.

If the file does not exist, skip this step. This ensures backward compatibility with pipelines that predate Phase 5.5.

In refresh mode (`refresh-scope.yaml` exists), read from `phases/05.5-refresh-content-spec-analysis.yaml` instead.

### Step 2: Write the Introduction

Use the hook type and specific hook idea from the outline.

**Temporal framing:** Read the current date. Frame recent events using relative language ("recently", "just launched") rather than absolute ("in early 2026"). Absolute year references work in titles and meta descriptions for SEO but sound unnatural in body copy when the year is still new.

**Execution rules:**
1. Open with the hook. No preamble, no throat-clearing, no "In this article."
2. Follow the hook with 1-2 sentences of context: what problem this solves and who it's for.
3. End the introduction with a thesis sentence: what the reader will learn or be able to do.
4. Never reveal the post's conclusion or recommendation in the introduction. For comparison posts especially, the author's pick is the payoff -- tease the decision, don't resolve it upfront. The reader should want to keep reading to find out the answer.
5. Stay within the outline's word budget for the introduction (typically 150-250 words).

**Hook execution by type:**

| Hook Type | First Sentence Pattern |
|-----------|----------------------|
| Bold Claim | State the claim directly. No hedging. |
| Story Start | Drop into the moment. "Last week, I..." or "The deploy failed at 2am." |
| Contrarian | State the popular opinion, then pivot. "Everyone says X. The data says otherwise." |
| Question | Ask the question. Make it specific. Then immediately start answering it. |
| Statistic | Lead with the number. "40% faster. That's what we measured after..." |
| Problem | Describe the pain. The reader should nod in recognition. |

See [writing-patterns.md](./references/writing-patterns.md) for full hook formulas with examples and anti-patterns to avoid.

### Step 3: Write Body Sections

Write each H2 section from the outline in order. For each section:

1. **Start with the answer-first block.** The outline specifies a 40-60 word direct answer for each H2. Write this as the opening paragraph of the section. It should be self-contained -- an LLM could extract this paragraph as a standalone answer.

2. **Expand with supporting content.** After the answer-first block, develop the section's key points from the outline. Draw on specific findings from `research-notes.md`:
   - Data points and benchmarks
   - Community opinions (from HN, X, SO)
   - Code examples where relevant
   - Comparisons or trade-offs

3. **Follow the word count budget.** Each section in the outline has an estimated word count. Stay within ~10% of the target. If a section runs long, cut the weakest supporting point rather than trimming everything equally.

4. **Add transitions.** The last sentence of each section should connect to the next section's topic. Avoid formulaic transitions ("Now let's look at..."). Use the content itself to bridge: end with a question the next section answers, or a limitation the next section addresses.

5. **Include mermaid diagrams** where the outline marked `mermaid: yes`. Keep diagrams simple: 5-8 nodes maximum. Label nodes with short, clear text.

6. **Target featured snippets** where the outline flagged a snippet type:
   - `definition`: The answer-first block serves as the snippet candidate. Keep it 40-50 words.
   - `list`: Use a numbered or bulleted list immediately after the H2.
   - `table`: Use a markdown table as the primary content element.
   - `code`: Lead with a clean, runnable code block.

7. **Write descriptive link text.** Every link must have anchor text that makes sense without the surrounding sentence. Use the page title, tool name, or a specific descriptive phrase (2-6 words). Never use "click here", "read more", or bare URLs. Place punctuation outside link tags. See [link-text-rules.md](../style-guide/references/link-text-rules.md).

### Step 4: Write Code Examples

Apply these rules to all code blocks. See [writing-patterns.md](./references/writing-patterns.md) for the full code formatting reference.

1. **Every tutorial and how-to must include runnable code.** Explainers include code when it clarifies the concept.
2. **Show problem, then solution.** Label each: a comment line identifying the problematic approach and the improved approach.
3. **Keep blocks short.** 5-15 lines ideal. 25 lines maximum. Break longer examples into multiple blocks with explanation between.
4. **Use realistic names.** Not `foo`/`bar`. Use names from the post's domain.
5. **Always include the language identifier** in fenced code blocks (`jsx`, `typescript`, `bash`, etc.).
6. **Comment the "why", not the "what."** Do not comment every line. Only comment non-obvious logic.

### Step 5: Write the Builder.io Section (If Applicable)

Skip this step entirely for `awareness` content.

For `acquisition` content, write the Builder.io section based on the `integration_pattern` from Phase 1:

| Pattern | Approach |
|---------|----------|
| `product-showcase` | Builder.io is woven throughout the post as the tool being used. Product mention is organic because Builder.io IS the subject. |
| `before-after` | Dedicated section showing the workflow pain point and the Builder.io improvement. |
| `honest-comparison` | Feature comparison section where Builder.io is one of the options evaluated honestly. |
| `problem-solution` | Lead with the audience's pain point, then show how Builder.io solves it specifically. Not generic -- the solution must connect to the problem discussed. |
| `light-cta-only` | No dedicated section. A CTA line in the conclusion only. |

For `hybrid` content, skip this step. The CTA goes in the conclusion (Step 7).

**Hybrid anti-pattern -- competitor validation:** When the post's analysis section identifies limitations of a competitor's approach, do not write paragraphs that validate when the competitor's approach works ("the roundtrip earns its keep when...", "the right tool depends on team size"). The post's own analysis has already shown the limitations. The conclusion positions Builder.io as the better approach -- don't undermine it with hedging.

**Integration rules:**
- Reference the `builder_capability` from Phase 1 output (e.g., "parallel-agents", "collaborative-workspace", "figma-integration")
- Frame the Builder.io section around the `messaging_pillar` from Phase 1 output (Context, Collaboration, or Trust). The pillar determines the framing angle -- lead with the pillar's core message when introducing Builder.io's solution.
- The 80/20 rule: 80% of the article delivers standalone value. The Builder.io section is at most 20%.
- If the integration feels forced, use `light-cta-only` instead regardless of the planned pattern. Authenticity beats coverage.

See [writing-patterns.md](./references/writing-patterns.md) for the full integration pattern reference ranked by authenticity.

### Step 6: Write the FAQ Section (If in Outline)

If the outline includes an FAQ section:

1. Use the questions and answer sketches from the outline.
2. Write each answer in 40-60 words. Direct, self-contained, no hedging.
3. Use `**Q:**` and `**A:**` format for clean structure.
4. Each answer is a featured snippet candidate. Start with the direct answer, then add one supporting detail.

### Step 7: Write the Conclusion

1. **Summary:** 2-3 sentences restating the key takeaway. Not a section-by-section rehash -- the single most important thing the reader should remember.
2. **CTA:** Use the CTA template matching the content goal. See [writing-patterns.md](./references/writing-patterns.md) for templates by goal (awareness / acquisition / hybrid).

**Conclusion rules:**
- No "In conclusion..."
- No generic sign-offs ("Happy coding!", "I hope this was helpful")
- The CTA must reference something specific from the post
- Link text in CTAs follows the same rules: descriptive, standalone, specific. "Try Builder.io's React SDK quickstart" not "Try it here".
- Keep to the outline's word budget (typically 100-200 words)

### Step 8: Apply Paragraph Rhythm

Review the full draft for rhythm. See [writing-patterns.md](./references/writing-patterns.md) for the complete rhythm rules.

**Quick checks:**
- No paragraph longer than 3 sentences (4 is hard max)
- Sentence length varies within each section (mix short punches with longer explanations)
- Not every paragraph opens with a topic sentence
- Code blocks have setup paragraphs before and explanation after
- At least one paragraph per section starts with something other than a declarative statement (a question, example, code reference, or transition)

### Step 9: Apply Keyword Placement

From `phases/02-keyword-research.yaml`, ensure:

- **Primary keyword** appears in: the title, at least 2 H2 headings, the first paragraph, and the conclusion
- **Secondary keywords** appear in: at least 1 H2 heading each and the body text
- **Semantic keywords** (`also_talk_about` terms): scatter naturally through body sections for topical depth

Do not force keywords. If a keyword placement reads awkwardly, skip it. Search intent match matters more than keyword count.

**Seed keyword density targets:** If Step 1.5 loaded seed keyword targets, cross-reference the draft against those targets now. Count occurrences of each seed keyword in the draft. For keywords significantly below their target range, look for natural places to add them (section introductions, transition sentences, answer-first blocks). For keywords above their target range, do not remove them unless they read as stuffed. Document the final counts in `phases/06-blog-drafting.yaml`.

### Step 9.5: Keyword Density Check

Before assembling the final draft, run a quick density check. Count occurrences of the primary keyword, each secondary keyword, and any seed keywords. Compare against targets.

If 3+ keywords are significantly below their target range (less than 50% of the low end), the draft likely needs more content in those topic areas rather than keyword insertion. Consider whether a section is missing or too thin.

If 3+ keywords are significantly above their target range, check for unnatural repetition. Vary phrasing using semantic equivalents.

Record the density check results in `phases/06-blog-drafting.yaml` under a `keyword_density_check` field. This catches gaps at draft stage, before the 4-pass editing pipeline.

### Step 10: Assemble the Draft

Write the complete draft to `post.md` in the post output folder with this structure:

```markdown
---
title: "Selected Title from Outline"
date: YYYY-MM-DD
slug: topic-slug
author: Vishwas
primary_keyword: "keyword"
secondary_keywords: ["kw1", "kw2"]
meta_description: ""
content_goal: awareness | acquisition | hybrid
post_type: tutorial | comparison | explainer | how-to | thought-leadership
word_count: 0
status: draft
---

# Title

[Introduction]

## [H2 Section Heading]

[Answer-first block]

[Supporting content]

[... additional sections ...]

## FAQ

**Q: [Question]?**

[Answer]

**Q: [Question]?**

[Answer]

## Conclusion

[Summary + CTA]
```

After writing, count the words (excluding YAML frontmatter and code blocks) and update the `word_count` field.

## Output Schema

Write `phases/06-blog-drafting.yaml`:

```yaml
title_used: "Selected Title"
post_type: tutorial
content_goal: awareness
hook_type: "Bold Claim"
copywriting_framework: PAS
integration_pattern: none | product-showcase | before-after | honest-comparison | problem-solution | light-cta-only
builder_section_included: false
word_count: 2150
word_count_budget: 2200
sections_written: 6
code_blocks_count: 4
mermaid_diagrams_count: 1
faq_questions_written: 3
cta_type: awareness | acquisition | hybrid
primary_keyword_placements:
  - title
  - h2_1
  - h2_3
  - introduction
  - conclusion
secondary_keyword_placements:
  - h2_2: "rsc tutorial"
  - body: "react server components next.js"
keyword_density_check:
  seed_file_present: false
  keywords_below_target: []
  keywords_above_target: []
  keywords_on_target: []
spec_checklist_results:          # Only present if Phase 5.5 ran
  verified: []
  unverified: []
  not_applicable: []
status: draft
```

## Trending Topic Mode

When `content_timing: trending`, the drafting process stays the same with these adjustments:

### What Changes

1. **Research depth:** The synthesis matrix from Phase 4 has fewer sources. Lean more heavily on official docs and early community signal (HN, X). Acknowledge when information is preliminary.
2. **Keyword placement:** Use social-signal-derived keywords from Phase 2 instead of traditional keyword data. Placement rules still apply but are best-effort.
3. **FAQ answers:** Sourced from community questions (HN, X) rather than PAA. Answers may be shorter since less authoritative data exists.
4. **Featured snippets:** Snippet-formatted content is still written (answer-first blocks, lists, tables) but success is best-effort since no SERP baseline exists.

### What Stays the Same

- Hook execution
- Paragraph rhythm
- Code example formatting
- Builder.io integration routing
- CTA patterns
- Anti-pattern avoidance
- The outline's section structure and word count budget

### Trending Caveat

Add this note to the YAML frontmatter when `content_timing: trending`:

```yaml
content_timing: trending
trending_note: "SEO-specific elements are best-effort. Revisit after SERP data populates."
```

## Word Count Guidance

The outline's per-section word budget is the target. Follow it, not a fixed number. See [word-count-guidance.md](../shared/word-count-guidance.md) for the full word count logic.

**Primary signal:** The outline declares a target word count based on SERP competitive data (median of top 5 competitors + 10-20%). Use it. Do not reference a fixed table.

**If the draft exceeds the target:** Evaluate whether the overage adds value. If sections are thin padding, trim. If the extra words cover the topic more thoroughly, keep them. Warn if the draft exceeds the competitive median by 50%.

**SurferSEO keyword density:** When `seed/keywords.txt` exists, bias toward the upper end of the competitive range. Keyword density targets need distribution room.

**The goal is completeness of answer, not a word count target.** Some posts are better at 1,200 words, others need 4,000+. Write until the topic is covered, then stop. AEO optimization (Phase 9) may push slightly past the target -- that is acceptable.

## Voice and Tone

Delegate to the Style Guide skill for all voice and tone rules.

**Load order:**
1. Project default: `.builder/skills/style-guide/references/default-voice-and-tone.md`
2. Local override: `.content-style-guide.md` at project root

Local rules take precedence. If the Style Guide skill has not been built yet, apply these baseline rules:
- Conversational, direct tone. Use "you" and "I."
- No AI-sounding phrases. See anti-patterns in [writing-patterns.md](./references/writing-patterns.md).
- Short paragraphs. 1-3 sentences.
- Specific over generic. Always.

## Examples

### Example 1: Evergreen Tutorial Draft

**Input:** Outline for "How React Server Components Actually Work: A Practical Guide"
**Content timing:** `evergreen`
**Content goal:** `awareness`
**Post type:** `tutorial`
**Hook type:** Problem

**Draft opening:**

> Every React app eventually hits the waterfall problem. Fetch the user, wait. Fetch their posts, wait. Fetch the comments, wait. Each round trip adds 200-400ms, and your users notice.
>
> Server Components break that cycle. They run on the server, fetch data directly, and send only the rendered HTML to the client. No `useEffect`. No loading spinners for data that's available at render time.
>
> This guide walks through how Server Components actually work in Next.js 15 -- not the theory, but the implementation. By the end, you'll have a working example that replaces a client-side data fetching pattern with a Server Component that loads in half the time.

**CTA:** "Clone the starter repo and swap one of your existing client components: [link]. The performance difference shows up immediately in the Network tab."

### Example 2: Acquisition Comparison Draft

**Input:** Outline for "Headless CMS in 2026: Contentful vs Sanity vs Builder.io for React Teams"
**Content timing:** `evergreen`
**Content goal:** `acquisition`
**Integration pattern:** `honest-comparison`
**Post type:** `comparison`
**Hook type:** Question

**Draft opening:**

> Your team just decided to go headless. Now you're staring at 30+ CMS options and every comparison article reads like sponsored content.
>
> This one's different. I've built production apps with Contentful, Sanity, and Builder.io. Each has genuine strengths. Each has trade-offs I wish someone had told me about before I committed.
>
> Here's an honest comparison focused on what matters to React teams: developer experience, visual editing for non-technical teammates, and the hidden costs that don't show up on pricing pages.

**Builder.io section approach:** Honest comparison table. Builder.io wins on visual editing and framework-native components. Contentful wins on ecosystem maturity. Sanity wins on schema flexibility. Specific code examples from each.

**CTA:** "If visual editing is the priority for your team, Builder.io's React SDK takes about 10 minutes to set up. Try it with your existing components: [link to quickstart]"

### Example 3: Trending Explainer Draft

**Input:** Outline for "Claude 4.5's Extended Thinking: What It Is and How to Use It"
**Content timing:** `trending`
**Content goal:** `hybrid`
**Post type:** `explainer`
**Hook type:** Bold Claim

**Draft opening:**

> Extended thinking isn't chain-of-thought with a fancy name. It's the first time an LLM can genuinely pause to reason before answering -- and the API integration is three lines of code.
>
> Anthropic shipped extended thinking in Claude 4.5 last week, and the early benchmarks are striking: 78% accuracy on GPQA-Diamond (up from 65% without it) and near-perfect scores on competition-level math problems.
>
> Here's what extended thinking actually does, how it compares to chain-of-thought prompting, and the three-line API change to start using it.

**CTA (hybrid):** "Start with the API pattern above. If you're building a UI for testing prompts with extended thinking, Builder.io's AI playground lets you compare outputs side by side: [link]"

## Guidelines

- The outline is the contract. Follow its structure. Deviate only when a section clearly needs adjustment during writing (e.g., two thin sections that merge naturally).
- Answer-first blocks are the single most important structural element for AEO. Write them as if they'll be extracted verbatim by an LLM.
- The first draft does not need to be perfect. Phases 7-9 handle editing, SEO, and AEO refinement. Focus on getting the structure, voice, and core content right.
- When research is thin on a point, say less rather than padding. A confident 1,400-word post beats a padded 2,200-word one.
- If the Builder.io integration feels forced at any point during drafting, downgrade to `light-cta-only` regardless of the planned pattern. Note the downgrade in `phases/06-blog-drafting.yaml`.
- Code examples should be runnable. If you're not sure the code works, simplify until you are.
- Read the draft's headings alone after writing. They should tell a complete story.
- In refresh mode, KEEP sections are copied verbatim. The only modifications allowed are transition sentences at section boundaries to ensure flow with adjacent REWRITE/ADD sections.
- Refresh mode is backward-compatible. New posts never have a `refresh-scope.yaml` file, so Step 0.5 is skipped entirely for standard blog creation.
