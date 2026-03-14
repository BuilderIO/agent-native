---
name: content-refresh-research
description: "Runs the research phase of a content refresh — fetches the original post, analyzes keyword/SERP deltas, and scopes changes. Use as the first step when refreshing a post, or when the user wants to assess what changed since publication."
---

# Refresh Research Pipeline

Analyze an existing blog post against current keyword and SERP data to determine what changed and recommend a refresh scope. Runs Phases 0-3 (fetch original, fresh keyword research, fresh SERP analysis, delta analysis) with one approval gate. The output folder is compatible with `/content-refresh-write` for multi-session continuation or `/content-refresh --resume` for single-session continuation.

## Input

<folder> $ARGUMENTS </folder>

**If the folder above is empty:**

Scan `output/posts/` for existing post folders that contain a `seed/urls.txt`. Present the 5 most recent (by date prefix) using **AskUserQuestion**:

**Question:** "Which post do you want to refresh?"

List each folder with its title (from `metadata.yaml` or `post.md` frontmatter) and date.

If no post folders with `seed/urls.txt` exist, stop with: "No existing posts with seed URLs found in `output/posts/`. Run `/content-seed` first to set up a post for refresh."

**If the folder is provided but does not exist:** Stop with: "Output folder not found: [path]"

Do not proceed until a valid output folder is confirmed.

## Seed Validation

Validate the output folder has a `seed/` subfolder with at least one URL:

1. Check for `seed/urls.txt`
2. The first URL in `seed/urls.txt` is the original post to refresh
3. Additional URLs are supplementary reference materials

**If `seed/` does not exist or `seed/urls.txt` is empty:**

Stop with:

```
No seed folder found. Run /content-seed first to stage the original post URL.

The first URL in seed/urls.txt should be the blog post to refresh.
Additional seed files (keywords.txt, notes.md, articles) provide context for the refresh.
```

## Flag Detection

Check arguments for flags:

- **`--resume`:** Resume from last checkpoint. See Resume Support section.
- **`--scope <selective|full|metadata>`:** Override the scope recommendation. Skip Gate 1 and use the specified scope directly.

## Archive Original

Before writing any new artifacts, archive the current state:

1. Create `archive/` subfolder in the output directory (if it does not exist)
2. If `post.md` exists: copy to `archive/post-pre-refresh-YYYY-MM-DD.md`
3. If `metadata.yaml` exists: copy to `archive/metadata-pre-refresh-YYYY-MM-DD.yaml`
4. Create `archive/phases/` and copy existing phase files that will be overwritten

Use today's date for the archive filenames. If an archive with today's date already exists (multiple refreshes in one day), append `-2`, `-3`, etc.

**Safety guarantee:** This command does NOT modify `post.md` or `metadata.yaml`. It creates `archive/`, `phases/00-03`, and `refresh-scope.yaml`. The original post remains untouched until `/content-refresh-write` or the monolithic `/content-refresh` runs.

## Pre-Flight: Ahrefs Budget Check

Before starting Phase 0, check available Ahrefs API units:

1. Call `subscription-info-limits-and-usage` via Ahrefs MCP
2. A refresh research pipeline uses approximately 1,200 units (keyword research + SERP analysis, no topic discovery)
3. **If remaining units < 1,200:** Warn: "Ahrefs budget is low ([X] units remaining, ~1,200 needed). Continue anyway?"
4. **If Ahrefs MCP is unavailable:** Warn: "Ahrefs MCP is not connected. Keyword and SERP analysis will use WebSearch fallbacks. Continue?"

Proceed only after the user confirms (or if budget is sufficient).

## Resume Support

Check for a `--resume` flag in the arguments.

**If `--resume` is present:**

1. Scan `phases/` for refresh-specific files (`00-original-post-analysis.yaml`, `01-refresh-keyword-research.yaml`, `02-refresh-serp-analysis.yaml`, `03-delta-analysis.yaml`)
2. Check for `refresh-scope.yaml` (Gate 1 complete)
3. Find the last completed refresh phase
4. Skip to the next incomplete phase
5. Announce: "Resuming refresh research from Phase N: [phase name]"

**If no `--resume` flag:** Start from Phase 0.

## Pipeline Execution

Use **TaskCreate** to create a task for each phase. This provides visible progress tracking throughout the pipeline.

### Dependency Graph

```
Phase 0:  Fetch & Parse Original Post      → depends on: seed folder
Phase 1:  Fresh Keyword Research            → depends on: 0
Phase 2:  Fresh SERP Analysis               → depends on: 0 (parallel with 1)
Phase 3:  Delta Analysis + Scope            → depends on: 1, 2 → GATE 1
```

Phases 1 and 2 can run in parallel (both depend only on Phase 0).

---

## Phase 0: Fetch & Parse Original Post

1. Read `seed/urls.txt` -- the first URL is the original post
2. Fetch the original post via WebFetch
3. Parse: extract title, headings (H2/H3), section content, word count, frontmatter
4. Check for existing pipeline metadata:
   - If `phases/01-topic-validation.yaml` exists: read `content_goal`, `content_timing`, keywords
   - If not: reconstruct from post analysis:
     - `content_goal`: scan for Builder.io mentions (promotional = `acquisition`, CTA only = `hybrid`, absent = `awareness`)
     - `content_timing`: default to `evergreen`
     - Keywords: extract from title, H2 headings, and first paragraph
5. Read any additional seed files (`seed/*.md`, `seed/keywords.txt`, `seed/notes.md`)

**Output:** `phases/00-original-post-analysis.yaml`

```yaml
url: "https://example.com/blog/topic"
title: "Original Post Title"
slug: "topic-slug"
publish_date: "2025-06-15"
word_count: 2150
content_goal: awareness
content_timing: evergreen
has_pipeline_metadata: true
original_primary_keyword: "react server components"
original_secondary_keywords: ["rsc tutorial", "server components"]
sections:
  - heading: "Introduction"
    word_count: 200
    level: 1
  - heading: "What Are React Server Components?"
    word_count: 400
    level: 2
headings_count: 6
seed_files_detected:
  - "seed/urls.txt"
  - "seed/notes.md"
```

---

## Phase 1 + Phase 2: Fresh Keyword Research + Fresh SERP Analysis (Parallel)

**Agent:** seo-researcher

**Spawn Phase 1 and Phase 2 as parallel Task agents in a single message.** Both depend only on Phase 0 output. After both complete, proceed to Phase 3.

### Phase 1: Fresh Keyword Research

Re-run the Keyword Research skill for the post's primary keyword. Use the keyword identified in Phase 0 (`original_primary_keyword`).

**SurferSEO hand-off:** If `seed/keywords.txt` contains SurferSEO density targets, include them in the keyword output (`phases/01-refresh-keyword-research.yaml`) so Phase 6 (drafting) can apply them without data loss between sessions.

**Output:** `phases/01-refresh-keyword-research.yaml`

**Note:** Different filename from original `01-topic-validation.yaml` to avoid overwriting.

### Phase 2: Fresh SERP Analysis

Re-run the SERP Analysis skill for the primary keyword.

**Output:** `phases/02-refresh-serp-analysis.yaml`

---

## Phase 3: Delta Analysis + Scope Recommendation

**Skill:** content-refresh-analysis

Compare Phase 0 (original) against Phase 1 + 2 (fresh data). Incorporate seed materials (new articles, keywords, notes).

**Output:** `refresh-scope.yaml` + `phases/03-delta-analysis.yaml`

### GATE 1: Scope Decision

Present the delta analysis using **AskUserQuestion**:

**Show the user:**

| Field               | Value                            |
| ------------------- | -------------------------------- |
| Original post       | Title + URL                      |
| Primary keyword     | Old ranking → Current ranking    |
| SERP changes        | New competitors, new features    |
| Sections to KEEP    | Count + list                     |
| Sections to REWRITE | Count + list with reasons        |
| Sections to ADD     | Count + list with reasons        |
| Recommended scope   | metadata-only / selective / full |
| Content goal change | None / recommended change        |
| Estimated effort    | Phases that will run             |

**Question:** "Delta analysis complete. How do you want to proceed?"

**Options:**

1. **Accept recommendation** -- Proceed with the recommended scope
2. **Override to selective** -- Force selective rewrite
3. **Override to full** -- Force full rewrite regardless of delta
4. **Override to metadata** -- Just re-optimize SEO/AEO metadata, no content changes
5. **Stop** -- Abandon refresh

**If overridden:** Update `refresh-scope.yaml` with `scope_override: true` and `original_recommendation`.

**If `--scope` flag was provided:** Skip Gate 1 and use the specified scope.

### Content Goal Resolution

After Gate 1, read `content_goal` from `phases/00-original-post-analysis.yaml`.

If the delta analysis recommended a content goal change and the user accepted it at Gate 1, use the new goal.

Write the resolved `content_goal` into `refresh-scope.yaml` so downstream commands can read it directly.

---

## Research Complete

When Gate 1 is resolved, present the research summary:

```
Refresh research complete!

Original: [title] ([publish date])
URL: [url]
Scope: [metadata-only / selective / full]
Content Goal: [awareness/acquisition/hybrid] [changed from X → if changed]

## Keyword Delta
- Primary: [keyword] (old ranking: [X] → current: [Y])
- New secondary keywords: [list]
- Dropped keywords: [list]

## SERP Delta
- New competitors: [count]
- AI Overview: [present/absent/changed]
- Featured Snippet: [present/absent/changed]

## Sections
- KEEP: [count] sections
- REWRITE: [count] sections
- ADD: [count] sections

Output folder: [folder path]
```

### Next Steps (Scope-Aware)

Use **AskUserQuestion** to present options based on the resolved scope:

**For selective or full scope:**

**Question:** "Research complete. What would you like to do next?"

**Options:**

1. **Write the refreshed post** -- Run `/content-refresh-write [folder]` after `/clear` for a fresh context (recommended)
2. **Continue in same session** -- Continue with `/content-refresh --resume` (single-session fallback)
3. **Review artifacts** -- Read the delta analysis or individual phase files
4. **Done** -- Save research for later

**For metadata-only scope:**

**Question:** "Research complete. Scope is metadata-only -- no content changes needed."

**Options:**

1. **Optimize** -- Run `/content-optimize [folder]` after `/clear` (recommended)
2. **Continue in same session** -- Continue with `/content-refresh --resume` (single-session fallback)
3. **Review artifacts** -- Read the delta analysis or individual phase files
4. **Done** -- Save research for later

**Factual staleness note:** Include in the completion summary: "If more than 3 days pass before running the next command, consider re-running `/content-refresh-research` to get fresh data."

---

## Error Handling

### Ahrefs MCP Unavailable

If any Ahrefs MCP call fails during the pipeline:

1. Log the failure in the current phase's YAML output
2. Fall back to WebSearch-based research for that specific call
3. Note reduced data quality in the phase output
4. Continue the pipeline -- do not stop

### WebFetch Failure (Original Post)

If the original post URL cannot be fetched (paywall, JS-rendered, 404):

1. Check if `seed/article.md` exists (user may have pasted the content manually)
2. If yes: use `seed/article.md` as the original post content
3. If no: ask the user to paste the post content into `seed/article.md` and re-run

### Phase Failure

If a phase produces an error or incomplete output:

1. Announce the failure to the user
2. Ask whether to retry the phase, skip it, or stop the pipeline
3. If skipped, write a stub YAML with `skipped: true` and `reason`

## Important Notes

- This command creates the same refresh artifact structure as `/content-refresh`, making it fully compatible with `/content-refresh-write` (multi-session) and `/content-refresh --resume` (single-session). A user can run `/content-refresh-research` today and `/content-refresh-write` or `/content-refresh --resume` tomorrow.
- This command is non-destructive: it creates `archive/`, phase files (00-03), and `refresh-scope.yaml`, but never modifies `post.md` or `metadata.yaml`. The original post remains untouched.
- Gate 1 (scope decision) lives here because it depends on the delta analysis. The user needs to decide the scope before any content work begins.
- Refresh-specific phase files use the `refresh-` prefix (e.g., `01-refresh-keyword-research.yaml`) to avoid overwriting original pipeline artifacts.
- Content goal routing applies here too: the resolved `content_goal` is written to `refresh-scope.yaml` for downstream commands to read.
- Each agent invocation receives the full output folder path to read previous phase artifacts.
