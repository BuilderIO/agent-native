---
name: content-refresh
description: "Refreshes an existing blog post against current keyword and SERP data. Use when the user wants to update an old post, check if content is outdated, or re-optimize existing content."
---

# Content Refresh Pipeline

Refresh an existing blog post by analyzing what changed in the competitive landscape, then selectively rewriting sections that need updates while preserving sections that are still strong. Produces an updated post preserving the original URL and slug.

## Output Folder

<output_folder> $ARGUMENTS </output_folder>

**If the output folder above is empty:**

Scan `output/posts/` for existing post folders. Present the 5 most recent (by date prefix) using **AskUserQuestion**:

**Question:** "Which post do you want to refresh?"

List each folder with its title (from `metadata.yaml` or `post.md` frontmatter) and date.

If no post folders exist, stop with: "No existing posts found in `output/posts/`. Run `/content-seed` first to set up a post for refresh."

**If the output folder is provided but does not exist:** Stop with: "Output folder not found: [path]"

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
- **`--scope <selective|full|metadata>`:** Override the tool's scope recommendation. Skip Gate 1 and use the specified scope directly.

## Archive Original

Before writing any new artifacts, archive the current state:

1. Create `archive/` subfolder in the output directory (if it does not exist)
2. If `post.md` exists: copy to `archive/post-pre-refresh-YYYY-MM-DD.md`
3. If `metadata.yaml` exists: copy to `archive/metadata-pre-refresh-YYYY-MM-DD.yaml`
4. Create `archive/phases/` and copy existing phase files that will be overwritten

Use today's date for the archive filenames. If an archive with today's date already exists (multiple refreshes in one day), append `-2`, `-3`, etc.

## Pre-Flight: Ahrefs Budget Check

Before starting Phase 0, check available Ahrefs API units:

1. Call `subscription-info-limits-and-usage` via Ahrefs MCP
2. A refresh pipeline uses approximately 1,200 units (keyword research + SERP analysis, no topic discovery)
3. **If remaining units < 1,200:** Warn: "Ahrefs budget is low ([X] units remaining, ~1,200 needed). Continue anyway?"
4. **If Ahrefs MCP is unavailable:** Warn: "Ahrefs MCP is not connected. Keyword and SERP analysis will use WebSearch fallbacks. Continue?"

Proceed only after the user confirms (or if budget is sufficient).

## Resume Support

Check for a `--resume` flag in the arguments.

**If `--resume` is present:**
1. Scan `phases/` for refresh-specific files (`00-original-post-analysis.yaml`, `01-refresh-keyword-research.yaml`, etc.)
2. Find the last completed refresh phase
3. Skip to the next incomplete phase
4. Announce: "Resuming refresh from Phase N: [phase name]"

**Checkpoints:** Phase 0 complete, Gate 1 approved, Gate 2 approved, Gate 3 approved, Phase 10 complete.

**If no `--resume` flag:** Start from Phase 0.

## Pipeline Execution

Use **TaskCreate** to create a task for each phase. This provides visible progress tracking throughout the pipeline.

### Dependency Graph

```
Phase 0:  Fetch & Parse Original Post      → depends on: seed folder
Phase 1:  Fresh Keyword Research            → depends on: 0
Phase 2:  Fresh SERP Analysis               → depends on: 0 (parallel with 1)
Phase 3:  Delta Analysis + Scope            → depends on: 1, 2 → GATE 1
Phase 4:  Content Research (conditional)    → depends on: 3
Phase 5:  Refresh Outline                   → depends on: 4 → GATE 2
Phase 5.5: Content Spec Analysis (Refresh)  → depends on: 5 (CONDITIONAL GATE)
Phase 6:  Draft / Selective Rewrite         → depends on: 5.5 → GATE 3
Phase 7:  Content Editing                   → depends on: 6
Phase 8:  SEO Optimization                  → depends on: 7
Phase 9:  AEO Optimization                  → depends on: 8
Phase 10: Post-Publish Checklist            → depends on: 9
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

## Phase 1: Fresh Keyword Research

**Agent:** seo-researcher

Re-run the Keyword Research skill for the post's primary keyword. Use the keyword identified in Phase 0 (`original_primary_keyword`).

**Output:** `phases/01-refresh-keyword-research.yaml`

**Note:** Different filename from original `01-topic-validation.yaml` to avoid overwriting.

## Phase 2: Fresh SERP Analysis

**Agent:** seo-researcher

Re-run the SERP Analysis skill for the primary keyword. Run in parallel with Phase 1.

**Output:** `phases/02-refresh-serp-analysis.yaml`

---

## Phase 3: Delta Analysis + Scope Recommendation

**Skill:** content-refresh-analysis

Compare Phase 0 (original) against Phase 1 + 2 (fresh data). Incorporate seed materials (new articles, keywords, notes).

**Output:** `refresh-scope.yaml` + `phases/03-delta-analysis.yaml`

### GATE 1: Scope Decision

Present the delta analysis using **AskUserQuestion**:

**Show the user:**

| Field | Value |
|-------|-------|
| Original post | Title + URL |
| Primary keyword | Old ranking → Current ranking |
| SERP changes | New competitors, new features |
| Sections to KEEP | Count + list |
| Sections to REWRITE | Count + list with reasons |
| Sections to ADD | Count + list with reasons |
| Recommended scope | metadata-only / selective / full |
| Content goal change | None / recommended change |
| Estimated effort | Phases that will run |

**Question:** "Delta analysis complete. How do you want to proceed?"

**Options:**
1. **Accept recommendation** -- Proceed with the recommended scope
2. **Override to selective** -- Force selective rewrite
3. **Override to full** -- Force full rewrite regardless of delta
4. **Override to metadata** -- Just re-optimize SEO/AEO metadata, no content changes
5. **Stop** -- Abandon refresh

**If overridden:** Update `refresh-scope.yaml` with `scope_override: true` and `original_recommendation`.

**If `--scope` flag was provided:** Skip Gate 1 and use the specified scope.

---

## Content Goal Routing

After Gate 1, read `content_goal` from `phases/00-original-post-analysis.yaml`.

If the delta analysis recommended a content goal change and the user accepted it at Gate 1, use the new goal.

Apply the same Content Goal Behavior Table as `/content-blog`:

```
IF content_goal == "acquisition" OR content_goal == "hybrid":
    Read .builder/skills/builder-product-knowledge/SKILL.md
    Pass positioning_context to Phase 5 (outline) and Phase 6 (drafting)
ELSE (awareness):
    Do NOT load builder-product-knowledge
```

---

## Phase 4: Content Research (Conditional)

**Agent:** content-researcher

- **metadata-only mode:** SKIP entirely. Write a stub: `phases/04-refresh-content-research.yaml` with `skipped: true`.
- **selective mode:** Research only for REWRITE and ADD sections. Pass section topics as the research focus. Skip sections marked KEEP.
- **full mode:** Full content research (same as `/content-blog` Phase 4).

**Output:** `phases/04-refresh-content-research.yaml` + updates to `research-notes.md`

---

## Phase 5: Refresh Outline

**Agent:** content-researcher (uses extended Outline Creation skill)

- **metadata-only mode:** SKIP entirely.
- **selective mode:** Refresh outline mode with KEEP/REWRITE/ADD markers (Step 0.5 in Outline Creation skill).
- **full mode:** Standard outline creation seeded with original structure.

**Output:** `phases/05-refresh-outline.yaml` + `outline.md`

### GATE 2: Outline Approval (skip for metadata-only)

Present the outline using **AskUserQuestion**:

**File to review:** Tell the user: "Read `outline.md` in the output folder for the full refresh outline with KEEP/REWRITE/ADD markers."

**Show the user:**
- Original title (preserved or changed)
- Sections marked KEEP (count and list)
- Sections marked REWRITE (count and list with changes)
- Sections marked ADD (count and list)
- Total word count budget

**Question:** "Refresh outline ready. How do you want to proceed?"

**Options:**
1. **Approve** -- Proceed to drafting
2. **Modify** -- Describe specific changes (re-runs Phase 5, re-presents Gate 2)
3. **Stop** -- Abandon refresh

---

## Phase 5.5: Content Spec Analysis (Refresh)

**Agent:** content-spec-analyzer

- **metadata-only mode:** SKIP entirely (no outline to validate).
- **selective/full mode:** Validate the approved refresh outline. Runs in refresh mode: KEEP sections are not individually validated (only checked for cross-references), REWRITE and ADD sections get full validation.

**Conditional Gate:** Same red/yellow/green behavior as `/content-blog` Phase 5.5.

**Output:** `phases/05.5-refresh-content-spec-analysis.yaml`

---

## Phase 6: Draft / Selective Rewrite

**Agent:** blog-writer (uses extended Blog Drafting skill)

- **metadata-only mode:** SKIP entirely.
- **selective mode:** Refresh drafting mode (Step 0.5 in Blog Drafting skill). Preserve KEEP sections, rewrite REWRITE sections, draft ADD sections.
- **full mode:** Standard blog drafting seeded with original voice.

**Output:** `phases/06-refresh-drafting.yaml` + `draft.md`

### GATE 3: Draft Approval (skip for metadata-only)

Present a draft summary using **AskUserQuestion**:

**File to review:** Tell the user: "Read `draft.md` in the output folder for the refreshed draft."

**Show the user:**
- Title
- Word count (old → new)
- Sections preserved vs rewritten vs added
- Voice consistency assessment

**Question:** "Refreshed draft complete. How do you want to proceed?"

**Options:**
1. **Proceed** -- Move to editing
2. **Request changes** -- Describe changes (re-runs Phase 6, re-presents Gate 3)
3. **Stop** -- Abandon refresh

---

## Phase 7: Content Editing

**Agent:** content-editor

Run 4-pass editing using the Content Editing skill. Same as `/content-blog` Phase 7.

Apply content goal checks during editing. Load style guide (dual-location).

**Output:** `phases/07-content-editing.yaml` (updated `draft.md` in place)

## Phase 8: SEO Optimization

**Agent:** search-optimizer

Run the 12-step SEO optimization. Same as `/content-blog` Phase 8 with these additions:

- Add `dateModified` to schema markup (today's date)
- Preserve the original `datePublished`
- Preserve the original slug
- For metadata-only mode: this is the first phase that runs after Gate 1. Read the original `post.md` as the working file.

**Output:** `phases/08-seo-optimization.yaml` (updated `draft.md` → becomes working `post.md`)

## Phase 9: AEO Optimization

**Agent:** search-optimizer

Run the 9-step AEO optimization. Same as `/content-blog` Phase 9.

**Output:** `phases/09-aeo-optimization.yaml` (updated `post.md` in place)

---

## Phase 10: Post-Publish Checklist

Run the 13-step final QA from the Post-Publish Checklist skill. Same as `/content-blog` Phase 10 with these additions:

- Verify original slug is preserved
- Update `metadata.yaml` with refresh history:

```yaml
refresh_history:
  - date: "2026-02-09"
    scope: selective-rewrite
    sections_rewritten: 2
    sections_added: 1
    word_count_before: 2150
    word_count_after: 2340
    archive: "archive/post-pre-refresh-2026-02-09.md"
```

- Set `pipeline_status: refresh-complete`

**Output:** `phases/10-post-publish-checklist.yaml` + `metadata.yaml`

---

## Pipeline Complete

When Phase 10 finishes, present the final summary:

```
Content refresh complete!

Original: [title] ([original publish date])
Refreshed: [new title if changed] ([today's date])
Scope: [metadata-only / selective (N sections rewritten, M added) / full]
Word Count: [old] → [new]
Content Goal: [unchanged / changed from X to Y]
Slug: [preserved]

Archive: archive/post-pre-refresh-YYYY-MM-DD.md

Output: output/posts/YYYY-MM-DD-topic-slug/post.md

Critical issues: [count]
Important issues: [count]
```

### Next Steps

Use **AskUserQuestion** to present options:

**Question:** "What would you like to do next?"

**Options:**
1. **Capture learnings** -- Run `/content-compound`
2. **View the post** -- Open `post.md`
3. **Compare with original** -- Open both `post.md` and `archive/post-pre-refresh-*.md`
4. **Done** -- End the pipeline

---

## Output Structure

```
output/posts/YYYY-MM-DD-topic-slug/
├── archive/                              # Pre-refresh backups
│   ├── post-pre-refresh-2026-02-09.md
│   ├── metadata-pre-refresh-2026-02-09.yaml
│   └── phases/                           # Original phase files
├── seed/                                 # User-provided (existing post URL + new materials)
├── phases/
│   ├── 00-original-post-analysis.yaml    # Parsed original post
│   ├── 01-refresh-keyword-research.yaml  # Fresh keyword data
│   ├── 02-refresh-serp-analysis.yaml     # Fresh SERP data
│   ├── 03-delta-analysis.yaml            # Delta comparison
│   ├── 04-refresh-content-research.yaml  # Targeted research
│   ├── 05-refresh-outline.yaml           # Refresh outline
│   ├── 05.5-refresh-content-spec-analysis.yaml  # Spec analysis (refresh)
│   ├── 06-refresh-drafting.yaml          # Draft metadata
│   ├── 07-content-editing.yaml           # Editing pass
│   ├── 08-seo-optimization.yaml          # Re-optimized
│   ├── 09-aeo-optimization.yaml          # Re-optimized
│   └── 10-post-publish-checklist.yaml    # Updated
├── refresh-scope.yaml                    # Section-level action plan
├── research-notes.md                     # Updated with refresh research
├── outline.md                            # Refresh outline with markers
├── draft.md                              # Refreshed draft
├── post.md                               # Final refreshed post
└── metadata.yaml                         # Updated with refresh history
```

## Error Handling

### Ahrefs MCP Unavailable

If any Ahrefs MCP call fails during the pipeline:
1. Log the failure in the current phase's YAML output
2. Fall back to WebSearch-based research
3. Note reduced data quality in the phase output
4. Continue the pipeline -- do not stop

### WebFetch Failure (Original Post)

If the original post URL cannot be fetched (paywall, JS-rendered, 404):
1. Check if `seed/article.md` exists (user may have pasted the content manually)
2. If yes: use `seed/article.md` as the original post content
3. If no: ask the user to paste the post content into `seed/article.md` and re-run

### Phase Failure

Same as `/content-blog`: announce failure, ask whether to retry, skip, or stop.

### Word Count Overflow

Same as `/content-blog`: flag if 50%+ above competitive median, suggest trimming, do not auto-trim.

## Important Notes

- Each agent invocation receives the full output folder path to read previous phase artifacts
- The Search Optimizer agent runs SEO (Phase 8) and AEO (Phase 9) sequentially -- do not parallelize
- Content goal routing follows the same table as `/content-blog`. Loading builder-product-knowledge for awareness content is not allowed.
- The archive step is critical. Always archive before overwriting any files. This allows the user to compare and revert.
- For metadata-only mode: Phases 4-6 and Phase 7 are skipped. The pipeline jumps from Gate 1 directly to Phase 8 (SEO re-optimization), then Phase 9 and Phase 10.
- Refresh-specific phase files use the `refresh-` prefix (e.g., `01-refresh-keyword-research.yaml`) to avoid overwriting original pipeline artifacts.
- Gate loops (Modify, Request Changes) re-present the same gate after re-running. They do not skip ahead.
