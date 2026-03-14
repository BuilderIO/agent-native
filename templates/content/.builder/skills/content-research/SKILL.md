---
name: content-research
description: "Runs the research phase from topic discovery through outline creation without proceeding to drafting. Use when the user wants to research a topic, explore keywords, analyze SERPs, or create an outline before committing to a full post."
---

# Research Pipeline

Research a topic and produce an outline without writing a draft. Runs Phases 1-5 (topic validation through outline creation) with one approval gate. The output folder is compatible with `/content-write` for multi-session continuation or `/content-blog --resume` for single-session continuation.

## Arguments

<args> $ARGUMENTS </args>

### Argument Disambiguation

```
IF args resolve to an existing directory on disk:
    IF directory contains hub-context.yaml:
        → Hub mode. Read hub context. Use existing folder.
    ELSE:
        → Pre-existing output folder (existing behavior)
ELSE IF args are empty:
    → Ask the user for a topic
ELSE:
    → Standalone mode. Treat args as a topic string.
```

**Directory check:** Use filesystem existence check. Do NOT use a `/` heuristic -- topics can contain slashes (e.g., "React 19/Server Components").

**If args are empty, ask the user:** "What topic do you want to research? Describe the subject and any angle or audience you have in mind."

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
│   ├── 04-content-research.yaml
│   ├── 05-outline-creation.yaml
│   └── 05.5-content-spec-analysis.yaml
├── research-notes.md
└── outline.md
```

**Topic slug rules:**
- Lowercase, replace spaces with hyphens, remove special characters
- Max 50 characters
- Same-day slug collision: append `-2`, `-3`, etc.

**Date:** Use today's date (YYYY-MM-DD format).

### Hub Mode

When a hub page folder is detected (contains `hub-context.yaml`):

1. **Use the existing folder** as the output folder -- do not create a new one
2. The `phases/` subdirectory already exists (created by `/content-hub` scaffold)
3. Skip topic slug generation entirely

#### Hub Context Pre-Population

Read hub context and pre-populate the pipeline:

1. **Read `hub-context.yaml`** from the target folder:
   - Extract: `hub_slug`, `page_type`, `page_slug`, `topic`, `primary_keyword`, `content_goal`

2. **Read `hub.yaml`** from `output/hubs/<hub_slug>/hub.yaml`:
   - Extract sibling keywords (for cannibalization awareness in Phase 2)
   - Extract link graph (for internal linking awareness in Phase 5)

3. **Write Phase 1 stub** to `phases/01-topic-validation.yaml` BEFORE invoking the content-strategist agent:
   ```yaml
   # Pre-populated from hub-context.yaml -- content strategist validates but does not pivot
   hub_slug: <hub_slug>
   page_type: <page_type>
   page_slug: <page_slug>
   topic: "<topic>"
   primary_keyword: "<primary_keyword>"
   content_goal: <content_goal>
   hub_pre_populated: true  # Signal to content-strategist to skip go/no-go and pivot
   ```

4. **Update hub.yaml** -- set this page's status from `planned` to `in-progress`:
   - Find the page entry (pillar or matching cluster slug) in `hub.yaml`
   - Update its `status` field to `in-progress`
   - If the hub's overall status is `scaffolded`, update it to `in-progress`

5. **Announce hub mode:** "Hub page detected: [page_type] page '[page_slug]' in hub '[hub_slug]'. Topic and primary keyword pre-populated from hub context."

The topic for display and pipeline use comes from `hub-context.yaml`, not from the command arguments.

## Seed Detection

After the output folder is set up, check for a `seed/` subfolder:

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
2. A research pipeline uses approximately 1,000 units (comparison posts: ~1,150 units due to per-subject keyword and SERP research)
3. **If remaining units < 1,000** (or < 1,150 for comparison posts)**:** Warn the user: "Ahrefs budget is low ([X] units remaining, ~1,000-1,150 needed for research). Continue anyway?"
4. **If Ahrefs MCP is unavailable:** Warn: "Ahrefs MCP is not connected. Keyword research and SERP analysis will use WebSearch fallbacks with reduced data quality. Continue?"

Proceed only after the user confirms (or if budget is sufficient).

## Pipeline Execution

### Dependency Graph (Evergreen)

```
Phase 1: Topic Validation         → depends on: none
Phase 2: Keyword Research          → depends on: 1
Phase 3: SERP Analysis             → depends on: 1
Phase 4: Content Research          → depends on: 2, 3
Phase 5: Outline Creation          → depends on: 4
Phase 5.5: Content Spec Analysis   → depends on: 5
```

### Dependency Graph (Trending)

When `content_timing: trending` (set in Phase 1):

```
Phase 1: Topic Validation         → depends on: none
Phase 2: Keyword Research          → depends on: 1 (trending mode)
Phase 3: SERP Analysis             → SKIPPED (write skipped: true stub)
Phase 4: Content Research          → depends on: 2 only (narrow skip mode)
Phase 5: Outline Creation          → depends on: 4
Phase 5.5: Content Spec Analysis   → depends on: 5 (trending mode)
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

The Phase 1 stub (`phases/01-topic-validation.yaml`) was already written during Hub Context Pre-Population with `hub_pre_populated: true`. The content-strategist agent detects this flag and adjusts:

- **Skip go/no-go evaluation** -- the topic was pre-validated during hub planning
- **Skip pivot** -- the topic is pinned from the hub plan. If the user wants a different topic, they edit `hub.yaml` and re-scaffold.
- **Still classify:** content_timing (should be `evergreen` for hub pages), builder_io_relevance, post_type, content_pillar
- **Still run keyword viability** (Phase 2 of the agent) -- seeded with `primary_keyword` from hub-context.yaml
- **Still run Builder.io capability selection** (Phase 3 of the agent) if `content_goal` is acquisition/hybrid

The agent enriches the existing Phase 1 stub with its classification fields rather than overwriting it. The `hub_slug`, `page_type`, `page_slug`, and `hub_pre_populated` fields are preserved.

**Output:** `phases/01-topic-validation.yaml` (enriched, not overwritten)

### GATE 1: Topic Approval

#### Standalone Gate 1

Present the strategist's findings using **AskUserQuestion**:

**Question:** "Topic evaluation complete. How do you want to proceed?"

**File to review:** Tell the user: "Review `phases/01-topic-validation.yaml` in the output folder for full classification details."

| Show the user | Value |
|--------------|-------|
| Topic | From validation |
| Content Goal | awareness / acquisition / hybrid |
| Content Timing | evergreen / trending |
| Recommendation | go / pivot / stop |
| Priority Score | From validation |
| Pivot Suggestion | If recommendation is "pivot" |

**Options:**
1. **Proceed** -- Accept the topic and classification as-is
2. **Pivot** -- Use the suggested pivot topic (re-runs Phase 1 with the pivot)
3. **Override** -- Accept the topic but change the content goal or timing classification
4. **Stop** -- Abandon this topic

**If Override:** Ask follow-up questions for the specific fields to change, update `phases/01-topic-validation.yaml`, and proceed.

**If Pivot:** Re-run Phase 1 with the pivot topic. Re-present Gate 1.

**If Stop:** End the pipeline. Announce the stop reason.

#### Hub Mode Gate 1

Present a simplified confirmation using **AskUserQuestion**:

**Question:** "Hub page topic validated. How do you want to proceed?"

| Show the user | Value |
|--------------|-------|
| Hub | hub_slug |
| Page Type | pillar / cluster |
| Topic | From hub-context.yaml |
| Primary Keyword | From hub-context.yaml |
| Content Goal | From hub-context.yaml |
| Content Timing | From classification (should be evergreen) |

**Options:**
1. **Proceed** (default) -- Accept the pre-assigned topic and classification
2. **Override content goal** -- Change the content goal for this page (updates hub-context.yaml and Phase 1 artifact)
3. **Stop** -- Abandon this page

Do NOT offer **Pivot** in hub mode. The topic is pinned from hub planning.

**If Override:** Ask which content goal to use, update `hub-context.yaml` and `phases/01-topic-validation.yaml`, and proceed.

**If Stop:** End the pipeline. Leave hub.yaml page status as `in-progress` (user can re-run later).

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

**Hub mode:** Use `primary_keyword` from `hub-context.yaml` as the seed keyword. Include sibling keywords from `hub.yaml` in the cannibalization check (avoid keyword overlap between hub pages).

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

The content-researcher agent spawns **6 parallel Task sub-agents**, one per source group (A-F). Each sub-agent writes its findings to `phases/04-research-group-{a-f}.yaml`. After all complete, the agent runs Synthesis to produce the unified output.

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

No gate after outline -- the purpose of this command is to produce research artifacts for later review, not to approve the outline interactively. The outline can be reviewed and approved when continuing with `/content-write` (recommended) or `/content-blog --resume`.

---

## Phase 5.5: Content Spec Analysis

**Agent:** content-spec-analyzer

Validate the outline proactively so that `/content-write` can skip this phase if it already exists. No gate -- the spec analysis output is informational in this context (the outline hasn't been approved yet).

1. Read all phase artifacts (01-05) plus `outline.md`, `research-notes.md`, and seed files (if present)
2. Run 4 analysis phases
3. Produce `phases/05.5-content-spec-analysis.yaml`

The spec analysis is included in the research summary output so the user can review issues alongside the outline before approving it in `/content-write`.

**Output:** `phases/05.5-content-spec-analysis.yaml`

---

## Research Complete

When Phase 5 finishes, present a research summary. Do not just output a file path -- present the key findings directly.

**Summary format:**

```
Research complete!

Topic: [topic]
Content Goal: [awareness/acquisition/hybrid]
Content Timing: [evergreen/trending]

## Keyword Strategy
- Primary: [keyword] (volume: [X], difficulty: [X], traffic potential: [X])
- Secondary: [list]
- Opportunity: [brief assessment]

## SERP Landscape
- Dominant format: [content type]
- AI Overview: [yes/no]
- Featured Snippet: [yes/no]
- Key gap: [what competitors are missing]

## Research Highlights
- [3-5 key insights from content research]
- Sources consulted: [count] across [platform count] platforms

## Title Options
1. [Title 1] (score: X/10)
2. [Title 2] (score: X/10)
3. [Title 3] (score: X/10)

## Outline
[Display the full outline from outline.md]

## Spec Analysis
Confidence: [green/yellow/red]
Critical: [count] | Important: [count] | Minor: [count]
[If yellow/red: list top issues]
[If green: "No issues found."]

Output folder: [output folder path]
```

For trending topics, SERP Landscape shows "Skipped (trending topic)" instead of competitive data.

**Hub mode addition:** Prepend the summary with hub context:

```
Hub: [hub_slug] ([page_type]: [page_slug])
```

### Next Steps

Use **AskUserQuestion** to present options:

**Question:** "Research is complete. What would you like to do next?"

**Options:**
1. **Write the post** -- Run `/content-write <folder>` after `/clear` for a fresh context (recommended)
2. **Write in same session** -- Continue to drafting with `/content-blog --resume` (single-session fallback)
3. **Review artifacts** -- Read the research notes or individual phase files
4. **Done** -- Save research for later

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

## Important Notes

- This command creates the same output folder structure as `/content-blog`, making it fully compatible with `/content-write` (multi-session) and `/content-blog --resume` (single-session). A user can run `/content-research` today and `/content-write` or `/content-blog --resume` tomorrow.
- Gate 2 (outline approval) is intentionally omitted. The outline is produced for review, not for interactive approval during research. This keeps the research command fast and non-blocking.
- Content goal routing applies here too: if the topic is acquisition/hybrid, the outline includes Builder.io section placement. If awareness, no Builder.io section.
- **Hub mode:** When pointed at a hub page folder, this command pre-populates Phase 1 from `hub-context.yaml` and disables topic pivot. The topic is pinned from hub planning. All hub-aware downstream skills (topic-discovery, outline-creation, seo-optimization, post-publish-checklist) activate via the `hub_slug` field in `phases/01-topic-validation.yaml`.
- **Standalone mode is unaffected.** All hub behavior is gated behind `hub-context.yaml` detection. If the argument is not an existing directory or does not contain `hub-context.yaml`, the command behaves identically to before.
