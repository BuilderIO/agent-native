---
name: content-refresh-write
description: "Rewrites changed sections of a refreshed post based on refresh research findings. Use after refresh research has identified scope, or when the user wants to rewrite specific sections of an existing post."
---

# Refresh Write Pipeline

Write and edit refreshed content from a completed refresh research folder. Runs Phases 4-7 (content research, refresh outline, draft/selective rewrite, content editing) with two approval gates. Picks up where `/content-refresh-research` left off.

## Input

<folder> $ARGUMENTS </folder>

**If the folder above is empty:** Scan `output/posts/` for folders that have refresh phases 00-03 complete and `refresh-scope.yaml` present but are missing phase 04. List eligible folders using **AskUserQuestion**:

**Question:** "Which refresh folder do you want to write from?"

**Options:** List each eligible folder path as an option (up to 4). If none found, announce: "No eligible refresh folders found. Run `/content-refresh-research` first to produce refresh research artifacts."

Do not proceed until a valid folder is selected.

## Scope Validation

Read `refresh-scope.yaml` from the output folder.

**If scope is `metadata-only`:** Exit with:

```
Scope is metadata-only -- no content changes needed.
Run /content-optimize [folder path] instead.
```

**If `refresh-scope.yaml` does not exist:** Stop with: "No refresh scope found. Run `/content-refresh-research` first."

## Validation

Check that the selected folder contains the required refresh research artifacts:

1. `phases/00-original-post-analysis.yaml` -- must exist
2. `phases/01-refresh-keyword-research.yaml` -- must exist
3. `phases/02-refresh-serp-analysis.yaml` -- must exist
4. `phases/03-delta-analysis.yaml` -- must exist
5. `refresh-scope.yaml` -- must exist (checked above)

**If any required file is missing:** Announce which files are missing and suggest running `/content-refresh-research` to complete the research phase. Do not proceed.

**If `phases/04-refresh-content-research.yaml` already exists:** Ask the user: "Refresh content research already exists in this folder. Overwrite it or stop?"

## Flag Detection

Check arguments for flags:

- **`--resume`:** Resume from last checkpoint. Scan `phases/` for refresh-specific files (04-05.5, 06-07), find the last completed phase, skip to the next incomplete.

## Content Goal Routing

Read `content_goal` from `refresh-scope.yaml`:

```
IF content_goal == "acquisition" OR content_goal == "hybrid":
    Read .builder/skills/builder-product-knowledge/SKILL.md
    Read builder-capabilities.md
    Select capability based on topic category from Phase 0 output
    Pass positioning_context to Phase 5 (outline) and Phase 6 (drafting)
ELSE (awareness):
    Do NOT load builder-product-knowledge
    Instruct Phase 6: "This is awareness content. Do not mention Builder.io."
```

Also read `content_timing` from `phases/00-original-post-analysis.yaml` for trending mode handling.

**Temporal context:** Note the current date. Pass it to Phase 6 (drafting) so headings and body copy use relative temporal framing.

---

## Phase 4: Content Research (Conditional)

**Agent:** content-researcher

- **selective mode:** Research only for REWRITE and ADD sections. Read the section topics from `refresh-scope.yaml` and pass them as the research focus. Skip sections marked KEEP.
- **full mode:** Full content research (same as `/content-blog` Phase 4).

**Output:** `phases/04-refresh-content-research.yaml` + updates to `research-notes.md`

---

## Phase 5: Refresh Outline

**Agent:** content-researcher (uses extended Outline Creation skill)

- **selective mode:** Refresh outline mode with KEEP/REWRITE/ADD markers (Step 0.5 in Outline Creation skill).
- **full mode:** Standard outline creation seeded with original structure.

**Output:** `phases/05-refresh-outline.yaml` + `outline.md`

### GATE 2: Outline Approval

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

**If Modify:** Re-run Phase 5 with modification instructions. Update `phases/05-refresh-outline.yaml` and `outline.md`. Re-present Gate 2.

---

## Phase 5.5: Content Spec Analysis (Refresh)

**Agent:** content-spec-analyzer

Validate the approved refresh outline before drafting. Runs in refresh mode: KEEP sections are not individually validated (only checked for cross-references), REWRITE and ADD sections get full validation.

1. Read refresh phase artifacts (00-05) plus `outline.md`, `research-notes.md`, `refresh-scope.yaml`, and seed files (if present)
2. Run 4 analysis phases in refresh mode
3. Produce `phases/05.5-refresh-content-spec-analysis.yaml`

**Conditional Gate:** Same red/yellow/green behavior as `/content-blog` Phase 5.5.

**Output:** `phases/05.5-refresh-content-spec-analysis.yaml`

---

## Phase 6: Draft / Selective Rewrite

**Agent:** blog-writer (uses extended Blog Drafting skill)

- **selective mode:** Refresh drafting mode (Step 0.5 in Blog Drafting skill). Preserve KEEP sections, rewrite REWRITE sections, draft ADD sections.
- **full mode:** Standard blog drafting seeded with original voice.

**Output:** `phases/06-refresh-drafting.yaml` + `draft.md`

### GATE 3: Draft Approval

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

---

## Write Complete

When Phase 7 finishes, present a summary:

```
Refresh write complete!

Original: [title] ([publish date])
Scope: [selective / full]
Title: [selected title]
Content Goal: [awareness/acquisition/hybrid]
Word Count: [old] → [post-editing count]
Sections: [kept] kept, [rewritten] rewritten, [added] added

Output: [folder path]
├── draft.md          <- Edited refreshed draft
├── outline.md        <- Approved refresh outline
├── research-notes.md <- Research artifacts
└── phases/           <- All phase artifacts (00-05.5, 06-07)

AI-voice issues caught: [count]
Critical issues: [count]
Important issues: [count]
Minor issues: [count]
```

### Next Steps

Use **AskUserQuestion** to present options:

**Question:** "Refreshed draft is written and edited. What would you like to do next?"

**Options:**

1. **Optimize** -- Run `/content-optimize [folder]` after `/clear` for SEO, AEO, and final QA (recommended)
2. **Review draft** -- Read `draft.md` for manual review
3. **Done** -- Save for later

Consider running `/content-polish` after optimization for long posts (>2,500 words).

---

## Error Handling

### Phase Failure

If a phase produces an error or incomplete output:

1. Announce the failure to the user
2. Ask whether to retry the phase, skip it, or stop the pipeline
3. If skipped, write a stub YAML with `skipped: true` and `reason`

### Gate Loops

Gate loops (Modify, Request Changes) re-present the same gate after re-running. They do not skip ahead.

### Word Count Overflow

If the refreshed draft exceeds the competitive median (or guidance range soft max) by 50%+ after Phase 7:

1. Flag the overflow in the editing report
2. Suggest trimming specific sections (identify the longest non-essential sections)
3. Do not auto-trim without user approval

## Important Notes

- This command produces the same output folder structure as `/content-refresh`, making it fully compatible with `/content-optimize` for the next step and `/content-refresh --resume` as an alternative single-session path.
- Gate 2 (outline approval) lives here because `/content-refresh-research` intentionally skips it -- the outline is produced for approval when writing begins, mirroring how `/content-write` handles Gate 2 for the blog pipeline.
- Gate 3 (draft approval) ensures the user reviews the refreshed draft before editing begins.
- Content goal routing reads from `refresh-scope.yaml` (not `01-topic-validation.yaml`). This is the resolved goal after any user-accepted changes at Gate 1.
- Phases 7-10 use standard filenames (no `refresh-` prefix) because they replace the blog optimization, not coexist with it. The archive step in `/content-refresh-research` preserves the originals.
- **Factual freshness warning:** If the original post contains version-specific claims (API versions, model capabilities, pricing, feature comparisons), verify they are still accurate before drafting. The refresh-research session fetched the original post and noted its claims, but days may have passed. Use WebSearch to spot-check critical claims during Phase 6.
