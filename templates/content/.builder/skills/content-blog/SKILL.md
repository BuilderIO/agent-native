---
name: content-blog
description: "Runs the full blog creation pipeline from topic to publish-ready post with approval gates. Use this skill whenever the user wants to write a blog post, create an article, start content from a topic, mentions publishing on the Builder.io blog, or references 'content:blog' (legacy syntax)."
---

# Blog Creation Pipeline

Create a publish-ready blog post from a topic. Runs 10 phases with 3 approval gates and 1 conditional gate, producing a structured output folder with all artifacts.

## Arguments

<args> $ARGUMENTS </args>

### Argument Disambiguation

```
IF arguments contain "--resume":
    → Resume mode. Extract topic/folder from remaining args.
ELSE IF args resolve to an existing directory on disk:
    IF directory contains hub-context.yaml:
        → Hub mode. Read hub context. Use existing folder.
    ELSE:
        → Pre-existing output folder (check for resume)
ELSE IF args are empty:
    → Ask the user for a topic
ELSE:
    → Standalone mode. Treat args as a topic string.
```

**Directory check:** Use filesystem existence check. Do NOT use a `/` heuristic -- topics can contain slashes.

**If args are empty, ask the user:** "What topic do you want to write about? Describe the subject and any angle or audience you have in mind."

Do not proceed until you have a topic or a valid folder path from the user.

## Output Folder Setup

### Standalone Mode (Default)

Create the output folder before any phase runs:

```
output/posts/YYYY-MM-DD-<topic-slug>/
├── phases/
│   ├── 01-topic-validation.yaml
│   ├── 02-keyword-research.yaml
│   ├── 03-serp-analysis.yaml
│   ├── 04-research-group-{a-f}.yaml  (per-group)
│   ├── 04-content-research.yaml      (unified)
│   ├── 05-outline-creation.yaml
│   ├── 05.5-content-spec-analysis.yaml
│   ├── 06-blog-drafting.yaml
│   ├── 07-content-editing.yaml
│   ├── 08-seo-optimization.yaml
│   ├── 09-aeo-optimization.yaml
│   └── 10-post-publish-checklist.yaml
├── research-notes.md
├── outline.md
├── draft.md
├── post.md
└── metadata.yaml
```

**Topic slug rules:**

- Lowercase, replace spaces with hyphens, remove special characters
- Max 50 characters
- Same-day slug collision: append `-2`, `-3`, etc.

**Date:** Use today's date (YYYY-MM-DD format).

**Temporal context:** Note the current date. Pass it to Phase 5 (outline) and Phase 6 (drafting) agents so they can use relative temporal framing in headings and body copy (e.g., "recently" instead of "in early 2026" when the year is new).

### Hub Mode

When a hub page folder is detected (contains `hub-context.yaml`):

1. **Use the existing folder** as the output folder -- do not create a new one
2. The `phases/` subdirectory already exists (created by `/content-hub` scaffold)
3. Skip topic slug generation entirely
4. **Read `hub-context.yaml`** → extract `hub_slug`, `page_type`, `page_slug`, `topic`, `primary_keyword`, `content_goal`
5. **Read `hub.yaml`** from `output/hubs/<hub_slug>/hub.yaml` → extract sibling keywords and link graph
6. **Write Phase 1 stub** to `phases/01-topic-validation.yaml` BEFORE invoking the content-strategist agent:
   ```yaml
   hub_slug: <hub_slug>
   page_type: <page_type>
   page_slug: <page_slug>
   topic: "<topic>"
   primary_keyword: "<primary_keyword>"
   content_goal: <content_goal>
   hub_pre_populated: true
   ```
7. **Update hub.yaml** -- set page status from `planned` to `in-progress` and hub status from `scaffolded` to `in-progress` if needed
8. **Announce:** "Hub page detected: [page_type] page '[page_slug]' in hub '[hub_slug]'. Topic and primary keyword pre-populated from hub context."

The hub mode behavior for Phase 1, Gate 1, and Phase 2 follows the same pattern as `/content-research` hub mode. See the research command for full details.

## Resume Support

Check for a `--resume` flag in the arguments.

**If `--resume` is present:**

1. Look for an existing output folder matching the topic slug (or the most recent folder if slug is ambiguous)
2. Read `metadata.yaml` or scan `phases/` to find the last completed phase
3. Skip to the next incomplete phase
4. Announce: "Resuming from Phase N: [phase name]"

**If no `--resume` flag:** Start from Phase 1. If the output folder already exists, ask the user whether to overwrite or resume.

## Seed Detection

After the output folder is set up (or selected via `--resume`), check for a `seed/` subfolder:

**If `seed/` exists and contains files:**

- Announce: "Seed folder detected. User-provided research will be merged with automated research."
- The Content Strategist agent will validate and summarize seed content during Phase 1 (Step 0.5)
- The SEO Researcher agent will merge seed keywords during Phase 2
- The Content Researcher agent will ingest seed URLs and articles during Phase 4
- Seed content supplements automated research -- all automated phases still run fully

**If `seed/` does not exist:** Proceed normally. No change to pipeline behavior.

**Seed content is read-once.** Files are read and validated at Phase 1 start. Mid-execution edits to seed files are not re-ingested.

## Pre-Flight: Ahrefs Budget Check

Before starting Phase 1, check available Ahrefs API units:

1. Call `subscription-info-limits-and-usage` via Ahrefs MCP
2. Check remaining units for the current billing period
3. A full blog post pipeline uses approximately 2,000 units (comparison posts: ~2,300 units due to per-subject keyword and SERP research)
4. **If remaining units < 2,000** (or < 2,300 for comparison posts)**:** Warn the user: "Ahrefs budget is low ([X] units remaining, ~2,000-2,300 needed). Keyword research and SERP analysis may be limited. Continue anyway?"
5. **If Ahrefs MCP is unavailable:** Warn: "Ahrefs MCP is not connected. Keyword research and SERP analysis will use WebSearch fallbacks with reduced data quality. Continue?"

Proceed only after the user confirms (or if budget is sufficient).

## Pipeline Execution

Use **TaskCreate** to create a task for each phase. This provides visible progress tracking throughout the pipeline.

### Dependency Graph (Evergreen)

```
Phase 1: Topic Validation         → depends on: none
Phase 2: Keyword Research          → depends on: 1
Phase 3: SERP Analysis             → depends on: 1
Phase 4: Content Research          → depends on: 2, 3
Phase 5: Outline Creation          → depends on: 4
Phase 5.5: Content Spec Analysis   → depends on: 5 (GATE: outline approval) (CONDITIONAL GATE)
Phase 6: First Draft               → depends on: 5.5
Phase 7: Content Editing           → depends on: 6 (GATE: draft approval)
Phase 8: SEO Optimization          → depends on: 7
Phase 9: AEO Optimization          → depends on: 8
Phase 10: Post-Publish Checklist   → depends on: 9
```

### Dependency Graph (Trending)

When `content_timing: trending` (set in Phase 1):

```
Phase 1: Topic Validation         → depends on: none
Phase 2: Keyword Research          → depends on: 1 (trending mode)
Phase 3: SERP Analysis             → SKIPPED (write skipped: true stub)
Phase 4: Content Research          → depends on: 2 only (narrow skip mode)
Phase 5: Outline Creation          → depends on: 4
Phase 5.5: Content Spec Analysis   → depends on: 5 (GATE: outline approval) (CONDITIONAL GATE, trending mode)
Phase 6: First Draft               → depends on: 5.5
Phase 7: Content Editing           → depends on: 6 (GATE: draft approval)
Phase 8: SEO Optimization          → depends on: 7 (handles absent SERP data)
Phase 9: AEO Optimization          → depends on: 8 (handles absent SERP data)
Phase 10: Post-Publish Checklist   → depends on: 9 (accepts empty SERP fields)
```

---

## Phase 1: Topic Validation

**Agent:** content-strategist

### Standalone Mode

Invoke the Content Strategist agent with the user's topic. The agent uses the Topic Discovery and Keyword Research skills to produce:

- `content_goal`: awareness | acquisition | hybrid
- `content_timing`: evergreen | trending
- `builder_io_relevance`: natural | light | none
- `builder_capability` and `integration_pattern` (for acquisition/hybrid only)
- Go/no-go recommendation with reasoning
- Priority score

**Output:** `phases/01-topic-validation.yaml`

### Hub Mode

The Phase 1 stub was already written during Hub Mode setup with `hub_pre_populated: true`. The content-strategist detects this flag and:

- **Skips go/no-go evaluation and pivot** -- topic pinned from hub planning
- **Still classifies:** content_timing, builder_io_relevance, post_type, content_pillar
- **Still runs keyword viability** seeded with `primary_keyword` from hub-context.yaml
- **Still runs Builder.io capability selection** if content_goal is acquisition/hybrid

The agent enriches the existing Phase 1 stub (preserves hub fields).

**Output:** `phases/01-topic-validation.yaml` (enriched, not overwritten)

### GATE 1: Topic Approval

#### Standalone Gate 1

Present the strategist's findings using **AskUserQuestion**:

**Question:** "Topic evaluation complete. How do you want to proceed?"

**File to review:** Tell the user: "Review `phases/01-topic-validation.yaml` in the output folder for full classification details."

| Show the user    | Value                            |
| ---------------- | -------------------------------- |
| Topic            | From validation                  |
| Content Goal     | awareness / acquisition / hybrid |
| Content Timing   | evergreen / trending             |
| Recommendation   | go / pivot / stop                |
| Priority Score   | From validation                  |
| Pivot Suggestion | If recommendation is "pivot"     |

**Options:**

1. **Proceed** -- Accept the topic and classification as-is
2. **Pivot** -- Use the suggested pivot topic (re-runs Phase 1 with the pivot)
3. **Override** -- Accept the topic but change the content goal or timing classification
4. **Stop** -- Abandon this topic

**If Override:** Ask follow-up questions for the specific fields to change (content goal, timing, etc.), update `phases/01-topic-validation.yaml`, and proceed.

**If Pivot:** Re-run Phase 1 with the pivot topic. Re-present Gate 1.

**If Stop:** End the pipeline. Announce the stop reason.

#### Hub Mode Gate 1

Present a simplified confirmation using **AskUserQuestion**:

**Question:** "Hub page topic validated. How do you want to proceed?"

| Show the user   | Value                 |
| --------------- | --------------------- |
| Hub             | hub_slug              |
| Page Type       | pillar / cluster      |
| Topic           | From hub-context.yaml |
| Primary Keyword | From hub-context.yaml |
| Content Goal    | From hub-context.yaml |

**Options:**

1. **Proceed** (default) -- Accept the pre-assigned topic and classification
2. **Override content goal** -- Change the content goal for this page
3. **Stop** -- Abandon this page

Do NOT offer **Pivot** in hub mode. The topic is pinned from hub planning.

---

## Content Goal Routing

After Gate 1 approval, read `content_goal` from `phases/01-topic-validation.yaml` and apply routing:

```
IF content_goal == "acquisition" OR content_goal == "hybrid":
    Read .builder/skills/builder-product-knowledge/SKILL.md
    Read builder-capabilities.md
    Select capability based on topic category from Phase 1 output
    Pass positioning_context to Phase 5 (outline) and Phase 6 (drafting)
ELSE (awareness):
    Do NOT load builder-product-knowledge
    Instruct Phase 6: "This is awareness content. Do not mention Builder.io."
```

### Content Goal Behavior Table

This table drives how each downstream phase behaves based on the content goal:

| Phase             | Awareness                                                        | Acquisition                                                                                     | Hybrid                                                                           |
| ----------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **5. Outline**    | No Builder.io section                                            | Dedicated section or integrated (per integration pattern)                                       | End-of-article section only                                                      |
| **6. Drafting**   | Zero Builder.io mentions. Do NOT load builder-product-knowledge. | Load builder-product-knowledge. Select capability + integration pattern. Draft product mention. | Load builder-product-knowledge. Light CTA Only pattern only.                     |
| **7. Editing**    | Flag any gratuitous Builder.io mention as forced.                | Verify product mention follows 80/20 rule. Flag if >20% is product-focused.                     | Verify CTA is specific (not generic). Flag if product mention creeps beyond CTA. |
| **8. SEO**        | No change                                                        | 1-2 internal links to Builder.io product pages or docs                                          | 1 internal link to Builder.io                                                    |
| **9. AEO**        | No change                                                        | Include Builder.io in answer-first blocks where naturally relevant                              | No change                                                                        |
| **10. Checklist** | Verify zero forced product mentions                              | Verify product mention exists and is natural                                                    | Verify CTA exists and is topic-specific                                          |

**When the topic doesn't map to a Builder.io capability (acquisition/hybrid only):**

Ask the user: "This topic doesn't have an obvious Builder.io connection. How would you like to position Builder.io?"

Options:

1. Suggest a capability to highlight
2. Use Light CTA Only (downgrade to hybrid behavior)
3. Switch to awareness (no product mention)

Store the answer in `phases/01-topic-validation.yaml` under `positioning_context`.

---

## Phase 2 + Phase 3: Keyword Research + SERP Analysis (Parallel)

**Agent:** seo-researcher

**Spawn Phase 2 and Phase 3 as parallel Task agents in a single message.** Both depend only on Phase 1 output. After both complete, proceed to Phase 4.

### Phase 2: Keyword Research

Run keyword research using the Keyword Research skill:

1. Call `keywords-explorer-overview` for the primary keyword
2. Call `keywords-explorer-matching-terms` and `keywords-explorer-related-terms` for expansion
3. Select primary keyword, 3-5 secondary keywords, 5-10 semantic keywords
4. Assess keyword difficulty and traffic potential

**Hub mode:** Use `primary_keyword` from `hub-context.yaml` as the seed keyword. Include sibling keywords from `hub.yaml` in the cannibalization check.

**Trending mode:** Run keyword research in trending mode (lighter Ahrefs calls, accept limited data).

**Output:** `phases/02-keyword-research.yaml`

### Phase 3: SERP Analysis

Run SERP analysis using the SERP Analysis skill:

1. Call `serp-overview` for the primary keyword
2. Analyze top 10 results for content type, word count, structure
3. Identify content gaps and opportunities
4. Check for AI Overview and Featured Snippet presence

**Trending mode:** Skip entirely. Write a stub file:

```yaml
skipped: true
reason: "Trending topic -- no established SERP to analyze"
content_timing: trending
```

**Output:** `phases/03-serp-analysis.yaml`

---

## Phase 4: Content Research (Parallel Sub-Agents)

**Agent:** content-researcher

The content-researcher agent spawns **6 parallel Task sub-agents**, one per source group (A-F). Each sub-agent writes its findings to a separate artifact file (`phases/04-research-group-{a-f}.yaml`). After all complete, the agent runs Synthesis to produce the unified `research-notes.md` and `phases/04-content-research.yaml`.

See the content-researcher agent for full parallel architecture details.

**Trending mode (narrow skip):** Spawn groups A-E only (skip F/SO+LLM). Reddit (group C) still runs best-effort.

**Output:** `phases/04-research-group-{a-f}.yaml` (per-group) + `phases/04-content-research.yaml` (unified) + `research-notes.md`

**Dependencies:**

- Evergreen: Depends on Phase 2 AND Phase 3
- Trending: Depends on Phase 2 only

---

## Phase 5: Outline Creation

**Agent:** content-researcher

Create the post outline using the Outline Creation skill:

1. Read all phase artifacts (01-04)
2. Score and select title (3-5 options)
3. Select hook type based on post type
4. Structure sections with AEO-friendly headings (question-form H2/H3s)
5. Place answer-first blocks under question headings
6. Apply post-type template from outline templates
7. For acquisition/hybrid: place Builder.io section per integration pattern

**Output:** `phases/05-outline-creation.yaml` + `outline.md`

### GATE 2: Outline Approval

Present the outline using **AskUserQuestion**:

**File to review:** Tell the user: "Read `outline.md` in the output folder for the full outline with headings, key points, and word count budgets."

**Show the user:**

- 3-5 title options with scores
- Selected hook type
- Full outline structure (sections, headings, key points)
- Target word count
- Builder.io integration placement (if acquisition/hybrid)

**Question:** "Outline ready. How do you want to proceed?"

**Options:**

1. **Approve** -- Proceed to drafting with this outline
2. **Modify** -- Describe specific changes (re-runs Phase 5 with modifications, re-presents Gate 2)
3. **Regenerate** -- Discard and regenerate from scratch (re-runs Phase 5, re-presents Gate 2)
4. **Stop** -- Abandon the pipeline

---

## Phase 5.5: Content Spec Analysis

**Agent:** content-spec-analyzer

Validate the approved outline before committing to a full draft. The spec analyzer reads all research artifacts and the outline, then checks structural feasibility, content domain rules, artifact alignment, and risk.

1. Read all phase artifacts (01-05) plus `outline.md`, `research-notes.md`, and seed files (if present)
2. Run 4 analysis phases: structural feasibility, content domain validation (post-type-specific), artifact alignment, risk assessment
3. Produce `phases/05.5-content-spec-analysis.yaml` with confidence (red/yellow/green), issues, verification checklist, and outline adjustments

**Trending mode:** Skips SERP-dependent checks (AEO heading-to-PAA mapping, competitive word count vs SERP median, featured snippet verification). Records skipped checks in `checks_skipped`.

**Output:** `phases/05.5-content-spec-analysis.yaml`

### Conditional Gate: Spec Analysis

This is a **conditional gate** -- it only pauses when there are problems. Green confidence auto-proceeds without user input.

| Confidence | Condition                                                                     | Behavior                                      |
| ---------- | ----------------------------------------------------------------------------- | --------------------------------------------- |
| **Green**  | No critical issues AND (`important_count < 3` AND `cross_cutting_count == 0`) | Auto-proceed to Phase 6                       |
| **Yellow** | No critical issues AND (`important_count >= 3` OR `cross_cutting_count >= 1`) | Present report, offer options                 |
| **Red**    | 1+ critical issues                                                            | Block drafting, present issues, offer options |

**Yellow options** (use **AskUserQuestion**):

**Question:** "Spec analysis found issues. How do you want to proceed?"

1. **Proceed** -- Acknowledge risks, continue to Phase 6 (verification checklist passed to writer)
2. **Fix outline** -- Return to Phase 5 with issue list as modification context, re-run Gate 2, re-run Phase 5.5
3. **Stop** -- End pipeline

**Red options** (use **AskUserQuestion**):

**Question:** "Spec analysis found critical issues. How do you want to proceed?"

1. **Fix outline** -- Return to Phase 5 with critical issues as modification context, re-run Gate 2, re-run Phase 5.5
2. **Override** -- Proceed anyway (user explicitly accepts critical risks)
3. **Stop** -- End pipeline

After 3 fix-loop iterations, suggest stopping and rethinking the approach.

---

## Phase 6: First Draft

**Agent:** blog-writer

Write the first draft using the Blog Drafting skill:

1. Read all phase artifacts (01-05, 05.5) plus `outline.md`
2. Execute the selected hook type
3. Write in Vishwas's voice (conversational, example-driven, concise)
4. Place primary keyword in title, first paragraph, one H2, conclusion
5. Place secondary keywords naturally throughout
6. Target word count from outline (SERP competitive median or guidance range; leave 3-5% buffer for editing phases)
7. For acquisition/hybrid: write Builder.io integration using the selected capability and pattern
8. For awareness: do not mention Builder.io
9. If `phases/05.5-content-spec-analysis.yaml` exists: consult `verification_checklist` and verify claims during drafting. Record results in `phases/06-blog-drafting.yaml`.

**Output:** `phases/06-blog-drafting.yaml` + `draft.md`

### GATE 3: Draft Approval

Present a draft summary using **AskUserQuestion**:

**File to review:** Tell the user: "Read `draft.md` in the output folder for the full draft text."

**Show the user:**

- Title used
- Word count
- Hook type and opening line
- Section count
- Builder.io integration approach (if any)

**Question:** "First draft complete. How do you want to proceed?"

**Options:**

1. **Proceed** -- Move to editing
2. **Request changes** -- Describe specific changes (re-runs Phase 6 with feedback, re-presents Gate 3)
3. **Stop** -- Abandon the pipeline

---

## Phase 7: Content Editing

**Agent:** content-editor

Run 4-pass editing using the Content Editing skill:

1. **Clarity pass** -- Simplify sentences, remove jargon, improve readability
2. **Flow pass** -- Check transitions, logical progression, pacing
3. **AI-voice pass** -- Detect and rewrite AI-sounding patterns (5-pass sub-workflow from ai-voice-detection.md)
4. **Engagement pass** -- Strengthen hooks, add specificity, improve examples

**Content goal checks during editing:**

- **Awareness:** Flag any gratuitous Builder.io mention as forced
- **Acquisition:** Verify product mention follows 80/20 rule (flag if >20% product-focused)
- **Hybrid:** Verify CTA is specific, flag if product mention creeps beyond CTA section

**Style guide loading:** Load the dual-location style guide (project default + local `.content-style-guide.md` override). Apply merged rules during all 4 passes.

**Output:** `phases/07-content-editing.yaml` (updated `draft.md` in place)

---

## Phase 8: SEO Optimization

**Agent:** search-optimizer

Run the 12-step SEO optimization from the SEO Optimization skill:

1. Meta description (150-160 chars, includes primary keyword)
2. SEO title tag (50-60 chars)
3. URL slug
4. Keyword placement verification
5. Internal linking (1-2 Builder.io links for acquisition; standard internal links)
6. External linking (2-4 authoritative sources)
7. Schema markup (BlogPosting at minimum; FAQPage/HowTo if applicable)
8. E-E-A-T signals
9. Featured snippet optimization
10. Image alt text review
11. Search intent cross-check
12. Heading hierarchy validation

**Trending mode:** Accept absent SERP data. Skip competitive gap references. Focus on on-page fundamentals.

**Output:** `phases/08-seo-optimization.yaml` (updated `draft.md` → becomes working `post.md`)

## Phase 9: AEO Optimization

**Agent:** search-optimizer

Run the 9-step AEO optimization from the AEO Optimization skill:

1. Heading compliance audit (question-form H2/H3s from outline)
2. Answer-first block verification
3. Quote-ready block audit (concise, standalone answers)
4. Specificity enhancers (numbers, dates, versions)
5. Brand Radar check via Ahrefs (acquisition/hybrid only; skip for awareness)
6. PAA (People Also Ask) coverage
7. Semantic keyword distribution
8. Word count final gate (per post type ceiling)
9. Final review pass

**Trending mode:** Full AEO optimization. Skip Brand Radar Ahrefs integration (no established citation data).

**Output:** `phases/09-aeo-optimization.yaml` (updated `post.md` in place)

---

## Phase 10: Post-Publish Checklist

**Agent:** (no agent -- run the Post-Publish Checklist skill directly)

Run the 13-step final QA:

1. YAML frontmatter completeness
2. Meta description verification
3. Image alt text audit
4. Internal link count and validation
5. External link count and validation
6. CTA review
7. Schema markup validation
8. Word count confirmation (per post type ceiling)
9. E-E-A-T signal check
10. Reverse internal link suggestions
11. Repurposing hook identification
12. Assemble `metadata.yaml` from all phase files
13. Set `pipeline_status: complete`

**Trending mode:** Accept empty SERP-derived fields. Add `trending_followup` scheduling to `metadata.yaml`.

**Output:** `phases/10-post-publish-checklist.yaml` + `metadata.yaml`

---

## Pipeline Complete

When Phase 10 finishes, present the final summary:

```
Blog post complete!

Topic: [topic]
Title: [selected title]
Content Goal: [awareness/acquisition/hybrid]
Word Count: [final count]
Status: [publish-ready / needs-fixes]

Output: output/posts/YYYY-MM-DD-topic-slug/
├── post.md          ← Final blog post
├── metadata.yaml    ← Full metadata
├── outline.md       ← Approved outline
├── research-notes.md ← Research artifacts
└── phases/          ← All phase artifacts

Critical issues: [count]
Important issues: [count]
Minor issues: [count]
```

**If `checklist_pass: false`:** List the critical issues that need manual fixes before publishing.

**If `checklist_pass: true`:** The post is ready to publish.

### Next Steps

Use **AskUserQuestion** to present options:

**Question:** "What would you like to do next?"

**Options:**

1. **Polish the post** -- Run `/content-polish` for section-by-section editorial review
2. **Resolve teammate feedback** -- Run `/content-revise` to address teammate comments
3. **Capture learnings** -- Run `/content-compound` on this post to document what worked and what didn't
4. **Done** -- End the pipeline

---

## Error Handling

### Ahrefs MCP Unavailable

If any Ahrefs MCP call fails during the pipeline:

1. Log the failure in the current phase's YAML output
2. Fall back to WebSearch-based research for that specific call
3. Note reduced data quality in the phase output
4. Continue the pipeline -- do not stop

### Phase Failure

If a phase produces an error or incomplete output:

1. Announce the failure to the user
2. Ask whether to retry the phase, skip it, or stop the pipeline
3. If skipped, write a stub YAML with `skipped: true` and `reason`

### Word Count Overflow

If the post exceeds the competitive median by 50%+ (or the guidance soft max if no SERP data) after Phase 9:

1. The Post-Publish Checklist flags it
2. Suggest trimming specific sections (identify the longest non-essential sections)
3. Do not auto-trim without user approval

## Important Notes

- Each agent invocation should receive the full output folder path so it can read previous phase artifacts and write its own output
- The Search Optimizer agent runs SEO (Phase 8) and AEO (Phase 9) sequentially -- do not parallelize. SEO must complete before AEO because AEO verifies heading changes made by SEO
- Content goal routing is the most important architectural decision in this command. Loading builder-product-knowledge for awareness content would defeat the purpose of the content goal system.
- The `--resume` flag is critical for long-running pipelines that may be interrupted. Always check for it before starting.
- Gate loops (Pivot, Modify, Regenerate, Request Changes) re-present the same gate after re-running. They do not skip ahead.
- **Hub mode:** When pointed at a hub page folder, this command pre-populates Phase 1 from `hub-context.yaml` and disables topic pivot. All hub-aware downstream skills activate via `hub_slug` in `phases/01-topic-validation.yaml`. Standalone mode is completely unaffected.
