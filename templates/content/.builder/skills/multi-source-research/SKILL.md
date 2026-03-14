---
name: multi-source-research
description: "This skill should be used when conducting multi-source research for a blog post. It covers extracting insights from official documentation, Hacker News threads, X/Twitter discourse, YouTube transcripts, Stack Overflow, and LLM query patterns. Includes source authority tiers, a mandatory synthesis matrix, plagiarism avoidance rules, and graceful degradation for sources with limited access."
---

# Content Research

Research a blog topic across multiple sources to identify content gaps, developer sentiment, expert perspectives, and unique angles. The output feeds Outline Creation (Phase 5) and provides the factual foundation for the entire post.

## When to Use This Skill

- After Keyword Research (Phase 2) and SERP Analysis (Phase 3) have completed
- When refreshing research for an existing post during content update
- When validating whether a topic has enough depth to justify a full post

## Prerequisites

- Keywords validated in `phases/02-keyword-research.yaml`
- SERP analysis in `phases/03-serp-analysis.yaml` (may be `skipped: true` for trending topics)
- Topic and content timing from `phases/01-topic-validation.yaml`

## Process

### Step 0: Check Content Timing

Read `content_timing` from `phases/01-topic-validation.yaml`.

**If `content_timing: trending`:** Use the Trending Topic Mode section below. This narrows the research scope but does NOT skip research entirely.

**If `content_timing: evergreen`:** Continue with Step 0.5.

### Step 0.5: Ingest Seed Content

Read `seed_detected` from `phases/01-topic-validation.yaml`.

**If `seed_detected: false`:** Skip to Step 1.

**If `seed_detected: true`:** Load the Seed Research skill and run Step 6 (Ingest for Phase 4):

1. **Fetch seed URLs:** Read `seed/urls.txt`. For each valid URL: skip blocked domains (reddit.com) with a note, attempt YouTube transcript tool for YouTube URLs, WebFetch all others. Log failures and continue. Tag each as `source_type: seed`.
2. **Parse seed articles:** Read all `.md` files in `seed/` (except `notes.md`). Extract title and source attribution. Weight as high-priority in synthesis. Tag each as `source_type: seed`.
3. **Parse seed notes:** Read `seed/notes.md` if non-empty. Use as "author perspective" context during synthesis. Tag as `source_type: seed_notes`.
4. **Track seed sources:** Record counts (URLs fetched, URLs failed, URLs blocked, articles parsed, notes ingested) for the Phase 4 output YAML.

Seed content is now loaded. Continue to Step 1 for full automated research. During Step 9 (Synthesize), merge seed sources alongside automated sources.

**Trending mode + seed:** Seed content is ingested even in trending mode. Seed URLs and articles bypass the narrow skip -- the user already has the data. After ingesting seed, continue with the trending research sequence.

### Step 1: Research Official Documentation (Group A)

Establish the factual foundation. Official docs are the authoritative baseline -- during Synthesis (Step 8), claims from other sources are verified against these facts.

1. Identify the authoritative source for the topic (official docs site, RFC, GitHub repo, announcement post)
2. Use WebFetch to read the relevant documentation pages
3. Extract:
   - Core definitions and terminology
   - Key features, APIs, or concepts
   - Code examples from official sources
   - Version-specific details (what version introduced this? what changed?)
   - Known limitations or caveats mentioned in docs

**For comparison posts (`post_type == "comparison"`):**

Go beyond surface-level feature lists. For each product being compared:

1. **Feature inventory**: Extract a list of key features with 1-sentence descriptions. Note which features are unique vs shared between products.
2. **Feature parity check**: Identify features that BOTH products have. Do not frame shared capabilities as differentiators. If both tools can do multi-file edits, say so -- then explain how the experience differs.
3. **Actual differentiators**: Focus on HOW each product achieves similar outcomes differently. The real differences are usually in:
   - Product + AI model integration quality (how well tool calling works, not just what models are supported)
   - Workflow philosophy (not just surface differences like "CLI vs IDE" but what that means for the developer's loop)
   - Where each tool ACTUALLY falls short (not strawman weaknesses)
4. **User switching stories**: Research why developers switch FROM one product to the other. The reasons people leave reveal the real gaps.

**Output:** A list of verified facts with source links. Every technical claim in the final post must trace back to an official source or be clearly labeled as opinion.

### Step 1.5: Individual Subject Research Across All Platforms (Comparison Posts Only)

**Only when `post_type == "comparison"`.**

Read `comparison_subjects` from `phases/01-topic-validation.yaml`. For Steps 2-7 below, run **three query sets per platform** instead of one:

1. **Comparison query:** The merged topic ("Claude Code vs Cursor") — surfaces comparative discussions
2. **Subject A query:** The first subject individually ("Claude Code") — surfaces deep feature content, standalone reviews, and tutorials
3. **Subject B query:** The second subject individually ("Cursor") — same depth for the other product

Individual product queries surface content that comparison posts only summarize: feature deep-dives, workflow breakdowns, real-world usage reports, and community pain points specific to each product. This is where the depth lives.

See [Comparison Query Patterns](./references/platform-research-guide.md#comparison-query-patterns) in the platform research guide for per-platform query templates.

**In the synthesis matrix (Step 8):** Track insights per-subject as well as comparative insights. Add a "Subject" column to distinguish which product an insight relates to.

### Step 2: Research Hacker News (Group B)

Hacker News provides the richest developer community signal available. Use the Algolia API (free, no key required).

**Step 2a: Find relevant threads**

Use WebFetch to search the Algolia API:

```
https://hn.algolia.com/api/v1/search?query=<topic>&tags=story&hitsPerPage=10
```

This returns titles, URLs, points, and comment counts. Sort mentally by points -- high-point threads have the best discussion.

**Step 2b: Read top thread comments**

For the top 2-3 threads (by points), fetch the full comment tree:

```
https://hn.algolia.com/api/v1/items/<story_id>
```

This returns the complete comment tree with author, text, points, and nested replies.

**Step 2c: Extract insights**

From HN threads, extract:
- **Pain points:** What frustrates developers about this topic?
- **Strong opinions:** Contrarian takes, heated debates, "actually..." corrections
- **Expert explanations:** Long comments from clearly experienced developers
- **Common questions:** Questions that appear in multiple threads
- **Misconceptions:** What do developers frequently get wrong?
- **Authentic language:** How developers describe this topic in their own words

Check both recent threads (last 6 months) and popular all-time threads for the topic.

### Step 3: Research X/Twitter (Group D)

WebSearch with `site:x.com` provides tweet snippets in result titles. This is enough for sentiment discovery.

1. Run WebSearch: `site:x.com <topic>` to find developer tweets
2. Run WebSearch: `site:x.com <topic> opinion OR think OR problem OR love OR hate` for stronger signals
3. Extract from tweet snippets:
   - Who is talking about this topic (influencers, core team members, practitioners)
   - Overall sentiment (positive, negative, mixed)
   - Hot takes and trending opinions
   - Questions developers are asking publicly

**Limitations:** Only tweet snippets in search result titles are accessible. No full threads, no engagement metrics. Use as a signal source, not a deep analysis source.

### Step 4: Research YouTube (Group E)

YouTube transcripts require an external tool. Check availability in this order:

1. **MCP tool available?** Check if a YouTube transcript MCP tool exists in the current session (e.g., `mcp-server-youtube-transcript`). If available, use it.
2. **npm CLI available?** Run `npx youtube-transcript --help` to check availability. If it works, use `npx youtube-transcript <video_url>` to get transcripts.
3. **Neither available?** Prompt the user with installation options before falling back:

   > YouTube transcript tool not found. Transcripts provide richer research (expert explanations, mental models, gaps in video coverage).
   >
   > **Option A (recommended):** Install npm package globally:
   > ```
   > npm install -g youtube-transcript
   > ```
   >
   > **Option B:** Add MCP server to Claude Code settings:
   > ```
   > claude mcp add youtube-transcript npx -y @anthropic/mcp-server-youtube-transcript
   > ```
   >
   > **Option C:** Skip YouTube transcripts for now (will use video titles/descriptions from WebSearch only).

   If the user chooses to install, wait for installation to complete, then proceed with transcript extraction. If the user skips, use WebSearch for video metadata only and note in the output: "YouTube transcripts not available -- user chose to skip installation. Used video metadata from WebSearch."

**When transcripts are available:**

1. WebSearch for `<topic> tutorial OR explained OR guide site:youtube.com` to find relevant videos
2. Get transcripts for the top 3-5 videos
3. Extract:
   - How experts explain the core concept (analogies, mental models)
   - Implementation approaches shown in video tutorials
   - What videos miss or gloss over (content opportunity)
   - Common follow-up questions in video comments (if accessible)

**Key rule:** Adapt explanations, never copy. The value is understanding HOW experts teach the topic, not reproducing their words.

### Step 5: Research Stack Overflow (Group F, Evergreen Only)

**Skip this step if `content_timing: trending`.** New topics will not have Stack Overflow content.

For evergreen topics, Stack Overflow reveals real-world implementation problems:

1. WebSearch for `site:stackoverflow.com <topic>` to find top questions
2. WebFetch the top 3-5 questions (SO pages are fully accessible)
3. Extract:
   - Most common error scenarios and their solutions
   - Gotchas and edge cases from accepted answers
   - Debugging tips from highly-upvoted answers
   - Common misconceptions corrected in answers
   - Version-specific issues (outdated answers vs. current solutions)

### Step 6: Research LLM Query Patterns (Group F, Evergreen Only)

**Skip this step if `content_timing: trending`.** LLMs will not have indexed just-announced topics.

Discover how AI assistants handle the topic:

1. Run WebSearch for `<topic> tutorial` and `<topic> explained` -- examine what content LLMs are likely trained on
2. Note which subtopics appear consistently across search results (must-cover topics)
3. Note which subtopics are absent or poorly covered (differentiation opportunity)
4. If content gaps exist where LLMs provide incorrect or outdated information, flag these -- correcting AI misconceptions is a strong content angle

### Step 7: Research Reddit (Group C)

Reddit has massive developer communities and is heavily cited by LLMs. Access is limited but worth attempting through multiple methods.

**Try these access methods in order:**

1. **WebSearch `site:reddit.com <topic>`** -- attempt first. May return Reddit thread URLs with title/snippet
2. **WebFetch `https://www.reddit.com/r/<subreddit>/search.json?q=<topic>&sort=relevance&t=year`** -- Reddit JSON API. Attempt even if expected to fail
3. **WebSearch `<topic> reddit discussion`** or **`<topic> reddit developers`** -- find third-party articles that summarize Reddit threads

**Extract the same categories as Hacker News:** pain points, misconceptions, authentic language, common questions, strong opinions.

Reddit is especially valuable for:
- Subreddit-specific pain points (r/reactjs, r/nextjs, r/webdev, etc.)
- Highly-upvoted workarounds that never make it into docs
- Authentic developer language (how people actually describe problems)
- Questions that appear in 3+ phrasings across threads (signals unmet demand)

If all access methods fail, note this in the output under source access notes and rely on HN + X as community sources. Do not silently skip Reddit -- always attempt it.

### Step 8: Compile Additional Sources (Conditional, Folded into Groups)

These supplementary sources are folded into the most relevant group's sub-agent prompt, or handled during Synthesis if no group is a natural fit:

- **Dev.to articles:** WebFetch works. Only include if a high-quality, in-depth article exists (skip shallow "Getting Started" posts). Best folded into Group A (official docs) or the most relevant platform group.
- **Tech blog posts:** WebFetch works for most blogs. Include if a notable author or company has written about the topic.
- **People Also Ask questions:** From `phases/03-serp-analysis.yaml` (evergreen only). These map directly to heading candidates. Handled during Synthesis.
- **Ahrefs competitive data:** From `phases/03-serp-analysis.yaml` (evergreen only). Note what competitors cover and where they fall short. Handled during Synthesis.

### Step 9: Synthesize Findings (Sequential -- After All Groups Complete)

Read all `phases/04-research-group-*.yaml` files produced by the parallel sub-agents. This is the most important step -- raw research is not useful, the synthesis is what makes the post differentiated.

**Handle missing or failed groups gracefully:** Missing group file = source skipped or failed. Group file with `status: failed` = attempted but unsuccessful (use partial findings if any). Unexpected fields in group files are preserved.

1. **Build the synthesis matrix** using the template from [synthesis-matrix-template.md](./references/synthesis-matrix-template.md). Map themes against sources. **If seed content was ingested:** add seed sources as columns in the matrix (e.g., "Seed: x-thread.md", "Seed: airops-draft.md"). Seed notes appear as "Seed: Author Notes".

2. **De-duplicate with seed sources:** If a seed URL was also discovered during automated research, skip the automated version -- seed was already captured (match by normalized URL: strip trailing slash, `www.` prefix, query params).

3. **Identify content gaps:**
   - Topic gaps: subtopics no existing source covers well
   - Depth gaps: topics covered superficially that deserve deep treatment
   - Recency gaps: outdated information across sources
   - Perspective gaps: all sources say the same thing -- where is the contrarian or practical view?
   - Accuracy gaps: where LLMs or popular sources get something wrong
   - Consider what seed content already covers when assessing gaps

4. **Formulate the unique value proposition:** In 2-3 sentences, articulate what this post will provide that no existing resource does. This drives the outline and becomes the implicit promise to the reader. Seed notes (author perspective) should inform this formulation.

5. **Assess source quality:** Note which sources were unavailable or degraded. If seed content was used, note: "Ingested N seed URLs + M seed articles + notes". This is important context for downstream phases.

## Plagiarism Avoidance Rules

- **Synthesize, do not summarize.** Transform information through the lens of the target audience and post angle.
- **Never copy phrases.** Even from official docs, rephrase in the post's voice.
- **Attribute ideas.** When referencing a specific person's insight or opinion, name them.
- **Code examples are exempt** from rephrasing -- official code examples can be reproduced with attribution.
- **Citation format:** Use contextual links with descriptive anchor text. Not footnotes, not APA/MLA.

**Good:** "As [Theo Browne explained in his RSC deep dive](url), the mental model shifts from..."
**Bad:** "According to [1], the mental model shifts from..."
**Worst:** Copying Theo's explanation without attribution.

## Output Schema

Write `phases/04-content-research.yaml`:

```yaml
sources_researched:
  official_docs:
    accessed: true
    urls:
      - "https://docs.example.com/feature"
    key_facts_count: 8
  hacker_news:
    accessed: true
    threads_analyzed: 3
    total_comments_reviewed: 150
    top_thread_id: "12345678"
  x_twitter:
    accessed: true
    method: "websearch_snippets"
    tweets_found: 12
  youtube:
    accessed: true | false
    method: "mcp" | "npm_cli" | "websearch_metadata" | "skipped"
    videos_analyzed: 3
    note: ""  # e.g., "Transcript tool not available, used metadata only"
  stack_overflow:
    accessed: true | false
    questions_analyzed: 5
    skipped_reason: ""  # e.g., "trending topic"
  reddit:
    accessed: false
    method: "indirect_websearch"
    indirect_summaries_found: 1
    note: "Direct Reddit access blocked. Found 1 third-party summary."
  llm_patterns:
    accessed: true | false
    skipped_reason: ""  # e.g., "trending topic"
  dev_to:
    accessed: false
    note: "No high-quality articles found"
content_gaps:
  - "No existing article covers X"
  - "Most sources miss Y"
  - "LLMs incorrectly state Z"
unique_value_proposition: "This post will be the first to combine A with B, providing C that no existing resource offers."
themes_identified:
  - "core concept"
  - "implementation patterns"
  - "edge cases"
  - "performance"
data_quality:
  sources_with_full_access: 4
  sources_with_partial_access: 2
  sources_unavailable: 1
  notes: "YouTube transcripts via MCP. Reddit indirect only."
# Seed source data (only when seed content ingested)
seed_sources:
  urls_fetched: 0
  urls_failed: 0
  urls_blocked: 0
  articles_parsed: 0
  notes_ingested: false
```

Also append to `research-notes.md`:

```markdown
## Content Research

### Key Facts (from Official Documentation)
- [Verified fact 1 with source link]
- [Verified fact 2 with source link]

### Developer Sentiment (from Hacker News, X & Community)
- Common pain point: [description]
- Recurring misconception: [what people get wrong]
- Authentic language: [how developers describe this topic]
- Strong opinions: [contrarian or notable takes from HN/X]

### Expert Perspectives (from YouTube)
- [Expert name] explains [concept] as [analogy/approach]
- Key implementation pattern from [video title]

### Common Gotchas (from Stack Overflow)
- [Gotcha 1 with SO link]
- [Debugging tip from accepted answer]

### LLM Query Patterns
- Subtopics LLMs consistently cover: [list]
- Subtopics LLMs consistently miss: [list] -- content opportunity

### Content Gaps Identified
- Gap 1: [No existing article covers X]
- Gap 2: [Developers consistently ask about Y but no tutorial exists]
- Gap 3: [LLMs provide incorrect information about Z]

### Research Synthesis Matrix
[Source-theme matrix table -- see synthesis-matrix-template.md]

### Source Access Notes
[Note any sources that were unavailable or degraded]

### Unique Value Proposition
[2-3 sentences: what this post will provide that no existing resource does]
```

## Trending Topic Mode

When `content_timing: trending`, use a narrow skip. Most research sources still apply -- only skip sources that require weeks of data accumulation.

### Trending Research Sequence

1. **Official docs** (PRIMARY): Announcement post, release notes, API docs, changelog. This is the authoritative source.
2. **Hacker News** (SECONDARY): Check Algolia API for threads about the announcement. HN threads often appear within hours of major announcements.
3. **X/Twitter** (SECONDARY): WebSearch `site:x.com <topic>` for immediate developer reaction and sentiment.
4. **YouTube** (CONDITIONAL): Attempt transcript extraction. YouTube creators often publish within 1-3 days of major announcements. If no videos exist yet, skip.
5. **Reddit** (BEST-EFFORT): Indirect WebSearch. If no Reddit signal found, skip without concern.
6. **Related prior art** (IF APPLICABLE): If the topic builds on something that existed before (e.g., "Claude 4.5" builds on "Claude 4"), research the predecessor topic for context.

### What to Skip for Trending

- **Ahrefs competitive data:** No metrics exist yet. Skip entirely.
- **LLM query patterns:** Not indexed yet. Skip.
- **Stack Overflow:** No questions exist yet. Skip.
- **Dev.to:** Unlikely to have quality content yet. Skip unless found.

### Trending Output Differences

The synthesis matrix will have fewer populated columns. This is expected. Note in `data_quality.notes`: "Trending topic -- some sources skipped or thin. Schedule `/content-compound` pass in 2-4 weeks."

## Parallel Execution

The source research tasks (Steps 1-7) are independent and run in parallel via sub-agents. Each group produces a standalone artifact file. The Content Researcher Agent spawns one Task sub-agent per group in a single message; all groups run concurrently.

**Orchestration:** The Content Researcher Agent (Phase 15) spawns the sub-agents. The `/content-blog` orchestrator skill (Phase 19) references this architecture. This skill documents the grouping, schema, and synthesis contract.

| Group | Sources | Skill Step(s) | Output File |
|:-----:|:--------|:--------------|:------------|
| A | Official docs (WebFetch) | Step 1 | `phases/04-research-group-a.yaml` |
| B | Hacker News (Algolia API via WebFetch) | Step 2 | `phases/04-research-group-b.yaml` |
| C | Reddit (WebSearch indirect) | Step 7 | `phases/04-research-group-c.yaml` |
| D | X/Twitter (WebSearch) | Step 3 | `phases/04-research-group-d.yaml` |
| E | YouTube (MCP/npm/WebSearch) | Step 4 | `phases/04-research-group-e.yaml` |
| F | Stack Overflow (WebFetch) + LLM patterns (WebSearch) | Steps 5-6 | `phases/04-research-group-f.yaml` |

**Trending mode:** Skip Group F (SO/LLM have no data for new topics). Groups A-E still run. Reddit (Group C) runs best-effort.

**Resume:** Check which `phases/04-research-group-*.yaml` files exist. Only re-run missing or `status: failed` groups.

After all groups complete, run Step 9 (Synthesis) sequentially to produce `phases/04-content-research.yaml` (unified) and `research-notes.md`.

### Per-Group YAML Schema

Each sub-agent writes its findings using this schema:

```yaml
# phases/04-research-group-{letter}.yaml
group: a  # a through f
source: "Official Documentation"  # human-readable source name
status: completed | failed | skipped
content_timing: evergreen | trending
is_comparison: false
findings:
  - title: "React Server Components RFC"
    url: "https://react.dev/reference/rsc/server-components"
    key_insights:
      - "RSC eliminates client-server waterfalls"
      - "Use 'use client' directive at component boundary"
    source_authority: tier_1  # tier_1 | tier_2 | tier_3 (see source-authority-tiers.md)
    relevance: high  # high | medium | low
data_quality:
  total_sources: 5
  verified_facts: 12
  unique_insights: 3
  notes: "Full access to official React docs and Next.js docs"
error:  # only present if status: failed
  step: 1
  message: "WebFetch returned 403 for documentation URL"
  retry_recommended: true
partial_findings: []  # findings recovered before failure
```

**Schema tolerance:** The Synthesis step (Step 9) handles variations gracefully -- unexpected fields are preserved, missing fields are noted as gaps, absent group files mean the source was skipped or failed.

## Examples

### Example 1: Evergreen Topic with Full Research

**Topic:** "React Server Components"
**Content timing:** `evergreen`

**Research findings:**
- Official docs: React docs cover RSC basics, Next.js docs cover App Router integration. 12 verified facts extracted.
- Hacker News: 3 threads with 200+ comments total. Strong debate about RSC complexity. Pain point: "mental model is confusing for teams migrating from Pages Router."
- X/Twitter: 15 tweet snippets. Mixed sentiment -- senior devs positive, mid-level devs frustrated. Dan Abramov's thread explaining the architecture is frequently referenced.
- YouTube: Transcripts from Theo Browne, Jack Herrington, Lee Robinson. Key insight: Lee's "think of RSC as the default" mental model is the clearest explanation.
- Stack Overflow: 5 questions. Top gotcha: "use client" directive placement confusion. Common error: trying to use hooks in server components.
- LLM patterns: LLMs consistently cover basic RSC definition but miss streaming SSR patterns and error boundary behavior with RSC.
- Reddit (indirect): Found one Dev.to article summarizing Reddit discussion. Pain point confirmed: "migration path from Pages Router."

**Unique value proposition:** "The first tutorial covering RSC migration from Pages Router to App Router with streaming patterns and error boundaries -- the three topics developers ask about most but no single resource addresses together."

### Example 2: Trending Topic with Narrow Skip

**Topic:** "Anthropic Claude 4.5 Sonnet"
**Content timing:** `trending`

**Research findings:**
- Official docs: Anthropic announcement blog post + API changelog. 8 verified facts about new capabilities.
- Hacker News: 2 threads, 400+ comments. Strong signal: developers excited about extended thinking, skeptical about pricing. Top question: "How does extended thinking compare to chain-of-thought?"
- X/Twitter: 20+ tweet snippets. Influencers comparing to GPT-5. Key angle: "first model to feel like a true coding partner."
- YouTube: 2 videos already up from Fireship and The AI Advantage. Transcripts extracted. Neither covers API integration patterns.
- Stack Overflow: Skipped (trending topic, no content yet).
- Reddit: Skipped (no indirect signal found).
- LLM patterns: Skipped (not indexed yet).

**Unique value proposition:** "The first hands-on tutorial showing Claude 4.5 API integration patterns -- every existing resource covers the announcement but none show how to actually use it in code."

### Example 3: Research with Degraded Access

**Topic:** "CSS Container Queries"
**Content timing:** `evergreen`

**Research findings:**
- Official docs: MDN comprehensive reference. 10 verified facts.
- Hacker News: 1 thread with 50 comments. Moderate interest.
- X/Twitter: 8 tweet snippets. Positive sentiment.
- YouTube: **Transcripts unavailable** (no MCP server or npm package installed). Used WebSearch for video metadata: found 4 relevant tutorials. Noted titles and channels for reference.
- Stack Overflow: 4 questions. Common gotcha: container queries don't work with inline elements.
- Reddit (indirect): No signal found.
- LLM patterns: LLMs cover basic syntax but miss the interaction between container queries and CSS Grid.

**Source access note:** "YouTube transcript tool not installed. Recommend installing `youtube-transcript` npm package or MCP server for richer research in future runs."

## Guidelines

- Always start with official documentation. Every other source is supplementary.
- Hacker News is the strongest community signal available. Prioritize it over Reddit and X for developer sentiment.
- See [source-authority-tiers.md](./references/source-authority-tiers.md) for the full source evaluation hierarchy.
- See [synthesis-matrix-template.md](./references/synthesis-matrix-template.md) for the matrix template.
- See [platform-research-guide.md](./references/platform-research-guide.md) for platform-specific extraction techniques and access methods.
- Do not force research from unavailable sources. Note the gap and move on. Degraded research is better than no research.
- The unique value proposition is the most important single output of this phase. If the post cannot articulate why it is different from what exists, reconsider the angle.
- Spend no more than 30 minutes on research for a single post. Depth on 3-5 good sources beats shallow coverage of 10.
