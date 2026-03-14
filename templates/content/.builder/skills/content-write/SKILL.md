---
name: content-write
description: "Writes and edits a blog post from completed research artifacts. Use when the user has finished research and wants to draft, or mentions writing from an existing outline or research folder."
---

# Write Pipeline

Write a first draft and run 4-pass editing from a completed research folder. Runs Phases 6-7 (blog drafting + content editing) with two approval gates. Picks up where `/content-research` left off.

## Input

<folder> $ARGUMENTS </folder>

**If the folder above is empty:** Scan `output/posts/` for folders that have phases 01-05 complete but are missing phase 06 (phase 05.5 may or may not exist). List eligible folders using **AskUserQuestion**:

**Question:** "Which research folder do you want to write from?"

**Options:** List each eligible folder path as an option (up to 4). If none found, announce: "No eligible research folders found. Run `/content-research` first to produce research artifacts."

Do not proceed until a valid folder is selected.

## Validation

Check that the selected folder contains the required research artifacts:

1. `phases/01-topic-validation.yaml` -- must exist
2. `phases/02-keyword-research.yaml` -- must exist
3. `phases/03-serp-analysis.yaml` -- must exist (or contain `skipped: true` for trending)
4. `phases/04-content-research.yaml` -- must exist
5. `phases/05-outline-creation.yaml` -- must exist
6. `outline.md` -- must exist
7. `research-notes.md` -- must exist

**If any required file is missing:** Announce which files are missing and suggest running `/content-research` to complete the research phase. Do not proceed.

**If `phases/06-blog-drafting.yaml` already exists:** Ask the user: "A draft already exists in this folder. Overwrite it or stop?"

## Content Goal Routing

Read `content_goal` from `phases/01-topic-validation.yaml`:

```
IF content_goal == "acquisition" OR content_goal == "hybrid":
    Read .builder/skills/builder-product-knowledge/SKILL.md
    Read builder-capabilities.md
    Select capability based on topic category from Phase 1 output
    Pass positioning_context to Phase 6 (drafting)
ELSE (awareness):
    Do NOT load builder-product-knowledge
    Instruct Phase 6: "This is awareness content. Do not mention Builder.io."
```

Also read `content_timing` from `phases/01-topic-validation.yaml` for trending mode handling.

**Temporal context:** Note the current date. Pass it to Phase 6 (drafting) so headings and body copy use relative temporal framing (e.g., "recently" instead of "in early 2026" when the year is new).

---

## GATE 2: Outline Approval

Before writing, present the outline for approval. Read `outline.md` and `phases/05-outline-creation.yaml`.

**File to review:** Tell the user: "Read `outline.md` in the output folder for the full outline with headings, key points, and word count budgets."

**Show the user:**
- 3-5 title options with scores (from Phase 5 YAML)
- Selected hook type
- Full outline structure (sections, headings, key points)
- Target word count
- Builder.io integration placement (if acquisition/hybrid)

Use **AskUserQuestion**:

**Question:** "Outline ready. How do you want to proceed?"

**Options:**
1. **Approve** -- Proceed to drafting with this outline
2. **Modify** -- Describe specific changes (re-runs Phase 5 with modifications, re-presents Gate 2)
3. **Regenerate** -- Discard and regenerate from scratch (re-runs Phase 5, re-presents Gate 2)
4. **Stop** -- Abandon the pipeline

**If Modify or Regenerate:** Re-run Phase 5 using the content-researcher agent with the modification instructions. Update `phases/05-outline-creation.yaml` and `outline.md`. Re-present Gate 2.

**If Stop:** End the pipeline. Announce the stop reason.

---

## Phase 5.5: Content Spec Analysis

**Agent:** content-spec-analyzer

Validate the approved outline before committing to a full draft. Runs the same validation as `/content-blog` Phase 5.5.

1. Read all phase artifacts (01-05) plus `outline.md`, `research-notes.md`, and seed files (if present)
2. Run 4 analysis phases: structural feasibility, content domain validation, artifact alignment, risk assessment
3. Produce `phases/05.5-content-spec-analysis.yaml`

**If `phases/05.5-content-spec-analysis.yaml` already exists** (produced during `/content-research`): Skip Phase 5.5. Announce: "Spec analysis already exists. Using existing results."

**Conditional Gate:** Same red/yellow/green behavior as `/content-blog` Phase 5.5. Green auto-proceeds, yellow/red present options (Proceed/Fix/Stop for yellow; Fix/Override/Stop for red).

**Output:** `phases/05.5-content-spec-analysis.yaml`

---

## Phase 6: First Draft

**Agent:** blog-writer

Write the first draft using the Blog Drafting skill:

1. Read all phase artifacts (01-05, 05.5) plus `outline.md` and `research-notes.md`
2. Execute the selected hook type
3. Write in Vishwas's voice (conversational, example-driven, concise)
4. Place primary keyword in title, first paragraph, one H2, conclusion
5. Place secondary keywords naturally throughout
6. Target word count from outline (SERP competitive median or guidance range; leave 3-5% buffer for editing phases)
7. For acquisition/hybrid: write Builder.io integration using the selected capability and pattern
8. For awareness: do not mention Builder.io
9. If `phases/05.5-content-spec-analysis.yaml` exists: consult `verification_checklist` and verify claims during drafting. Record results in `phases/06-blog-drafting.yaml`.

**Trending mode:** Acknowledge thinner research, use preliminary language, best-effort keywords/snippets.

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

## Write Complete

When Phase 7 finishes, present a summary:

```
Write phase complete!

Topic: [topic from Phase 1]
Title: [selected title]
Content Goal: [awareness/acquisition/hybrid]
Word Count: [post-editing count]
Compliance Score: [from editing report]

Output: [folder path]
├── draft.md          <- Edited draft
├── outline.md        <- Approved outline
├── research-notes.md <- Research artifacts
└── phases/           <- All phase artifacts (01-05.5, 06-07)

AI-voice issues caught: [count]
Critical issues: [count]
Important issues: [count]
Minor issues: [count]
```

### Next Steps

Use **AskUserQuestion** to present options:

**Question:** "Draft is written and edited. What would you like to do next?"

**Options:**
1. **Optimize** -- Run `/content-optimize` to apply SEO, AEO, and final QA (run `/clear` first for a fresh context)
2. **Review draft** -- Read `draft.md` for manual review
3. **Done** -- Save for later

---

## Error Handling

### Phase Failure
If a phase produces an error or incomplete output:
1. Announce the failure to the user
2. Ask whether to retry the phase, skip it, or stop the pipeline
3. If skipped, write a stub YAML with `skipped: true` and `reason`

### Gate Loops
Gate loops (Modify, Regenerate, Request Changes) re-present the same gate after re-running. They do not skip ahead.

## Important Notes

- This command produces the same output folder structure as `/content-blog`, making it fully compatible with `/content-optimize` for the next step and `/content-blog --resume` as an alternative single-session path.
- Gate 2 (outline approval) lives here because `/content-research` intentionally skips it -- the outline is produced for async review during research, then approved interactively before writing begins.
- Gate 3 (draft approval) ensures the user reviews the draft before editing begins.
- Content goal routing applies: if acquisition/hybrid, load builder-product-knowledge. If awareness, no Builder.io.
