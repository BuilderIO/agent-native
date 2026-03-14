---
name: content-editing
description: "This skill should be used when editing a first draft through 4 sequential passes: clarity, flow, AI-voice detection, and engagement. It covers the structured editing report format, word count enforcement, content-goal-aware checks, and the 5-pass AI-voice sub-workflow. Produces an editing report and modifies post.md in-place."
---

# Content Editing

Edit a first draft (`post.md`) through 4 sequential passes, each with specific criteria. The goal is a post that reads as genuinely human-written, flows naturally, and keeps the reader engaged. Modify `post.md` in-place and produce a structured editing report.

## When to Use This Skill

- After the first draft (Phase 6) has been approved at Gate 3
- When the `/content-blog` or `/content-lfg` orchestrator skill reaches Phase 7
- When re-editing after "Request changes" feedback

## Prerequisites

- Draft in `post.md` (from Phase 6)
- Blog drafting metadata in `phases/06-blog-drafting.yaml`
- Topic validation in `phases/01-topic-validation.yaml` (for `content_goal` and `content_timing`)
- Outline in `outline.md` (for structural reference)

## Process

### Step 0: Check Content Timing and Content Goal

Read `content_timing` and `content_goal` from `phases/01-topic-validation.yaml`.

**Content timing:**
- If `content_timing: trending`: The draft may have thinner supporting evidence. During Pass 1 (Clarity), do not flag sections as "unsupported" if the topic is too new for extensive sourcing. During Pass 4 (Engagement), accept community signal (HN, X) as sufficient evidence.
- If `content_timing: evergreen`: Apply all passes at full rigor.

**Content goal** (drives Pass 4 checks):
- `awareness`: Verify no promotional Builder.io mentions (product pitches, dedicated sections, CTAs). Internal links to related Builder.io blog posts are fine. If a promotional mention is found, flag as critical issue and remove.
- `acquisition`: Verify the Builder.io section follows the 80/20 rule (at most 20% of post). Verify the integration feels natural, not forced. If forced, flag as important issue and recommend downgrading to `light-cta-only`.
- `hybrid`: Verify Builder.io appears only in the conclusion CTA, not in body sections. If found in body, flag as important issue and relocate to conclusion.

### Step 1: Read Inputs

Load from the post output folder:

1. `post.md` -- the draft to edit
2. `phases/06-blog-drafting.yaml` -- word count, hook type, integration pattern
3. `outline.md` -- the approved structure (for structural deviation checks)
4. `phases/01-topic-validation.yaml` -- content goal, content timing

### Step 2: Pass 1 -- Clarity

Focus: simplify complex sentences, remove jargon, one idea per paragraph.

**Criteria:**
1. Every paragraph passes the "could a junior dev understand this?" test. If a concept requires context the post hasn't provided, add a one-sentence explanation or link.
2. One idea per paragraph. If a paragraph covers two concepts, split it.
3. Jargon check: any term not defined in the post and not universally known to the target audience needs a brief inline definition or removal.
4. Sentence length: flag sentences over 30 words. Rewrite to under 25 or split into two sentences.
5. Passive voice: flag and rewrite to active. ("The component is rendered by React" becomes "React renders the component.")

**"Prove It" sub-check:** Every technical claim needs supporting evidence -- a code example, benchmark number, link, or real-world result. Flag unsupported claims as important issues. (For trending topics, community signal counts as evidence.)

**"Specificity" sub-check:** Replace generic statements with concrete numbers, tool names, and versions. "Significantly faster" becomes "40% faster" or "loads in 200ms vs 800ms."

### Step 3: Pass 2 -- Flow

Focus: transitions between sections, logical progression, no abrupt topic changes.

**Criteria:**
1. Heading story test: read only the H2 headings in order. Do they tell a complete, logical story? If a heading feels out of place, flag it.
2. Transitions: the last sentence of each section should connect to the next section's topic. Flag sections that end abruptly. Do not add formulaic transitions ("Now let's look at..."). Use content bridges -- end with a question the next section answers, or a limitation the next section addresses.
3. Opening sentence of each section: should not repeat the heading. The answer-first block serves as the opening -- verify it directly answers the heading's implicit question.
4. Paragraph progression within each section: each paragraph should build on the previous one. Flag paragraphs that could be reordered without loss of meaning (a sign of list-like rather than narrative structure).
5. Section length balance: compare section word counts to the outline's budget. Flag sections that deviate by more than 20% from their budget. Trim or expand to match.

### Step 4: Pass 3 -- AI-Voice Detection

Focus: flag and rewrite phrases matching common LLM patterns.

Run the 5-pass AI-voice sub-workflow from [ai-voice-detection.md](./references/ai-voice-detection.md):

1. **Vocabulary Scan** -- Flag all Category A-D instances. Replace or cut per the reference tables.
2. **Structure Analysis** -- Check sentence length variation, Rule of Three lists, trailing participles, synonym carousels.
3. **Voice Injection** -- Verify each H2 section has at least one personal detail, opinion, or informal moment. Add where missing.
4. **Introduction/Conclusion Review** -- Re-read first 2-3 sentences and final paragraph for Category D patterns. Rewrite if found.
5. **Read-Aloud Test** -- Flag sentences with flat cadence, textbook tone, or phrasing nobody would say aloud.

Record the count of AI-voice issues found and fixed in the editing report.

### Step 4b: Style Guide Micro-Rules Sweep

After the AI-voice passes, run a targeted check for mechanical style guide violations that the macro passes miss.

**Checks:**

| Rule | Search Pattern | Action |
|------|---------------|--------|
| Rule 2 (overclaim superlatives) | "most [adjective]", "highest-leverage", "best in class", "every team", "every [role]", "always" (as unsupported claim) | Replace with comparative framing ("have an edge", "faster than") |
| Rule 3 (hedging) | "may prefer", "might work", "depends on your comfort level", "it varies", "strictly speaking" | Recommend directly ("start with X") or state the specific tradeoff |
| Rule 5 (em dashes) | `—`, `---` in prose (not code blocks) | Replace with period, comma, or restructure |
| Rule 6 (mass-addressing) | "most developers", "many teams", "people often", "everyone", "experienced [role]s often", "one [role]" (anonymous attribution) | Rewrite to first-person ("I connected") or direct second-person ("your first command") |
| Rule 7 (quote framing) | "put it this way:", "stated that:", "noted:" before quotes | Use parenthetical credentials and period instead of colon |
| Rule 9 (filler adverbs) | "very", "really", "actually", "basically", "essentially", "genuinely", "truly" | Cut or replace with specific detail |
| Rule 11 (contrastive) | Sentences containing "but ", "not ", "no ", "lack", "without ", "instead of", "rather than" in a contrastive frame | Rewrite affirmatively |
| Rule 12 (rhetorical questions) | Sentences ending with "?" that are not H2/H3 AEO headings | Rewrite as statements |
| Rule 13 (colon-as-em-dash) | Colons in prose (not code, not lists) where the colon introduces a restatement | Restructure to flow naturally |
| Rule 15 (product name caps) | Lowercase product names placed for keyword density | Capitalize proper nouns while preserving keyword presence |
| Rule 16 (link text) | "click here", "read more", "this article", "this post", bare URLs as anchor text, link text >10 words | Rewrite with descriptive anchor: page title, tool name, or specific phrase per [link-text-rules.md](../style-guide/references/link-text-rules.md) |
| Rule 8 (absolute URLs) | Builder.io blog links using relative paths (`/blog/<slug>`) | Replace with full absolute URL (`https://www.builder.io/blog/<slug>`) |

**Comparison post note:** Comparison posts ("X vs Y") naturally produce more contrastive patterns than tutorials or explainers. Flag Rule 11 at outline time and apply extra vigilance during this sweep.

Record the count of micro-rule fixes in the editing report under a new "Micro-Rules" section.

### Step 5: Pass 4 -- Engagement

Focus: strengthen the hook, add relatable examples, verify CTA is specific.

**Criteria:**
1. Hook check: does the opening still match the hook type from the outline? Is it specific to this post (not a generic opener that could apply to any article on the topic)? If weak, rewrite.
2. Example check: does each body section have at least one concrete example (code, screenshot description, real-world scenario, benchmark)? Flag sections with only abstract explanation.
3. CTA specificity: the conclusion's CTA must reference something specific from the post. "Try it out" is not specific. "Clone the starter repo and swap your UserList component" is specific.
4. Reader motivation: at least once per 500 words, the post should answer "why should I care?" for the current topic. Flag stretches longer than 500 words without a benefit or motivation statement.

**"So What" sub-check:** Every technical feature or concept must connect to a developer benefit. "React Server Components run on the server" needs "which means your users download less JavaScript." Flag feature descriptions without stated benefits.

**"Prove It's Real" E-E-A-T sub-check:** Flag first-person anecdotes that follow common AI fabrication templates: "I got this wrong the first time", "I spent [time] debugging", "I made this mistake and..." followed by a clean resolution. These are plausible-sounding but often fabricated. Mark with `<!-- VERIFY: personal anecdote -->` for author review. Do not auto-remove -- the author decides what's authentic.

**Content goal checks:**
- `awareness`: No promotional Builder.io mentions (product pitches, dedicated sections, CTAs). Internal links to Builder.io blog posts are fine. Flag promotional mentions if found.
- `acquisition`: Builder.io section follows 80/20 rule. Integration feels earned, not forced. The product mention solves a real problem established earlier in the post.
- `hybrid`: Builder.io CTA is in conclusion only. CTA connects the post's topic to a specific Builder.io capability. **Flag competitor-validation hedging:** cut any paragraph that validates when the competitor's approach works ("earns its keep when...", "right tool depends on team size", "no single right answer"). The post's analysis already covers limitations honestly -- don't undermine the Builder.io positioning with "but it works too" hedging.

### Step 6: Word Count Enforcement

After all 4 passes, count words in the edited `post.md` (excluding YAML frontmatter and code blocks). See [word-count-guidance.md](../shared/word-count-guidance.md) for the full word count logic.

- Check that the draft falls within the competitive range from the outline (`word_count_target` in `phases/05-outline-creation.yaml`). If no competitive data exists, check the guidance range for this post type from the shared reference.
- If significantly over (50%+ above competitive median or above the guidance soft max): trim. Cut the weakest supporting points first. Do not trim answer-first blocks, code examples, or the hook.
- If under the competitive range minimum: flag as a minor issue but do not pad. A tight post is better than a padded one.
- Update the `word_count` field in `post.md` frontmatter.

**Phase 8-9 buffer:** Leave room for SEO/AEO additions: **3-5% of target word count** (not a fixed number). A 4,000-word post needs more buffer than a 2,000-word post. If AEO pushes slightly past the target, that is acceptable.

### Step 7: Produce the Editing Report

Write a structured report summarizing all changes. This report is included in the output YAML.

```
## Editing Report

### Compliance Score: X/10

### Critical Issues (must fix): N
- [Line/section]: [Description] -> [Fix applied]

### Important Issues (should fix): N
- [Line/section]: [Description] -> [Fix applied]

### Minor Issues (consider): N
- [Line/section]: [Description] -> [Fix applied or recommendation]

### AI-Voice Issues Found: N
- Category A: N instances (all replaced)
- Category B: N instances (all replaced)
- Category C: N instances (all cut)
- Category D: N instances (all rewritten)
- Category E: N structural patterns fixed

### Well Done (reinforce):
- [Specific praise for elements that work well]
```

**Scoring guide:**
- **9-10:** Publish-ready after SEO/AEO passes. No critical issues.
- **7-8:** Strong draft. A few important issues resolved. Minor polish applied.
- **5-6:** Significant editing needed. Multiple important issues or several AI-voice patterns.
- **Below 5:** Consider requesting a rewrite of specific sections rather than editing.

### Step 8: Write Output Artifacts

Update `post.md` in-place with all edits applied. Update the `word_count` and `status` fields in the frontmatter:

```yaml
word_count: [updated count]
status: edited
```

Write `phases/07-content-editing.yaml`:

```yaml
passes_completed:
  - clarity
  - flow
  - ai_voice
  - engagement
word_count_before: 2200
word_count_after: 2180
compliance_score: 8
critical_issues: 0
important_issues: 2
minor_issues: 5
ai_voice_issues:
  category_a: 0
  category_b: 3
  category_c: 2
  category_d: 1
  category_e: 2
  total: 8
changes_summary: "Rewrote 3 AI-sounding sentences, added transition to section 3, trimmed section 4 by 80 words, added personal example to section 2"
content_goal_compliance: true
builder_mention_check: pass
status: edited
```

## Trending Topic Mode

When `content_timing: trending`, the editing process stays the same with these adjustments:

### What Changes

1. **Pass 1 (Clarity):** Accept community signal (HN threads, X posts, early blog reactions) as supporting evidence. Do not flag claims as unsupported if the topic is too new for benchmarks or academic sources.
2. **Pass 4 (Engagement):** Reader motivation is naturally higher for trending topics. Focus engagement checks on the hook and CTA rather than mid-article motivation statements.
3. **Word count:** Trending posts tend to be shorter (fewer sources to draw on). Do not flag under-length as an issue if the topic is adequately covered.

### What Stays the Same

- Pass 2 (Flow) -- structural quality matters regardless of timing
- Pass 3 (AI-Voice Detection) -- AI patterns must be caught regardless of timing
- Word count ceiling per post type (slight AEO overages OK)
- Content goal compliance checks
- The editing report format

## Examples

### Example 1: Clarity Pass Fix

**Before:**
> It's important to note that React Server Components can significantly reduce bundle size, which is particularly beneficial for applications that need to render large amounts of data on the server side, thus improving the overall user experience.

**After:**
> Server Components cut your JavaScript bundle. In our test app, the client-side JS dropped from 245KB to 89KB -- a 64% reduction. Pages load faster because the browser downloads and parses less code.

**Issues fixed:** Category C hedge ("It's important to note"), vague claim ("significantly reduce"), no specific numbers, passive construction, sentence over 30 words.

### Example 2: AI-Voice Detection Pass

**Before:**
> Let's dive into how Server Components handle data fetching. The framework provides a robust and seamless approach to server-side rendering, leveraging the latest advancements in React's architecture. This comprehensive solution offers three key benefits: reduced bundle size, improved performance, and better developer experience.

**After:**
> Server Components fetch data directly on the server. No `useEffect`, no loading states, no client-server waterfalls.
>
> The performance gain comes from skipping the browser entirely for data that doesn't need interactivity. I measured a 340ms improvement on our dashboard page after converting two components.

**Issues fixed:** Category D opener ("Let's dive into"), Category B words ("robust", "seamless", "leveraging", "comprehensive"), Rule of Three list, no personal detail, trailing participle implied in "leveraging."

### Example 3: Engagement Pass Fix

**Before (CTA):**
> In conclusion, Server Components are a powerful tool for modern React development. Try them out in your next project and see the difference they can make!

**After (CTA):**
> Pick one data-fetching component in your app -- the one with the most `useEffect` calls. Convert it to a Server Component and measure the bundle size difference. The Network tab tells the story.

**Issues fixed:** Category D closer ("In conclusion"), generic CTA ("try them out"), no specific action, "Happy coding"-style sign-off.

### Example 4: Content Goal Compliance

**Draft (awareness goal):** Section 3 mentions "Builder.io's visual editor handles this automatically."

**Flag:** Critical issue. Content goal is `awareness` -- no promotional Builder.io mentions allowed (product pitches, feature highlights, CTAs). Internal links to related Builder.io blog posts are fine, but this is a product pitch. Remove the sentence and replace with a framework-agnostic alternative.

## Guidelines

- Edit for the reader, not for word count. A tighter 1,800-word post beats a padded 2,200-word one.
- The 4 passes are sequential for a reason. Clarity fixes may change flow. Flow fixes may reveal AI patterns. AI-voice fixes may affect engagement. Run them in order.
- The AI-voice detection pass is the highest-value pass. Most first drafts (human or AI) benefit most from this pass. Spend the most time here.
- The editing report is for the human reviewer. Be specific about what changed and why. "Fixed AI voice" is not useful. "Replaced 'comprehensive guide' with 'this tutorial covers X, Y, and Z'" is useful.
- Voice injection (Sub-Pass 3) is not about faking personality. It's about ensuring the post contains the kind of details only a real person would include: specific project names, version numbers they've used, bugs they've hit, tools they prefer.
- Do not over-edit. If a sentence is clear, flows well, sounds human, and engages the reader, leave it alone. The goal is to fix problems, not to rewrite the post.
- Respect the word count target from the outline (SERP competitive median or guidance range). Phases 8-9 may push slightly past -- that is OK. A tight post that covers the topic beats a padded one.
