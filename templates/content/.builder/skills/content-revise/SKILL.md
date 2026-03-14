---
name: content-revise
description: "Resolves teammate feedback on a published post by applying corrections and updating artifacts. Use when the user mentions editorial comments, reviewer feedback, or corrections from a colleague."
---

# Revise Pipeline

Resolve teammate feedback on a post that has completed the full pipeline (Phases 1-10). Teammates review the article on Notion and leave comments as quoted text + feedback pairs. The orchestrator skill parses these into individual items, auto-generates proposed revisions with a mandatory voice gate, and walks through each item one-by-one interactively.

**Pipeline position:** Phase 12 (after Phase 11 Polish, before `/content-compound`)

**Output artifact:** `phases/12-team-review.yaml`

## Input

<folder> $ARGUMENTS </folder>

**If the folder above is empty:** Scan `output/posts/` for folders that have phases 01-10 complete and contain `post.md` with an eligible status. List eligible folders using **AskUserQuestion**:

**Question:** "Which post folder do you want to revise?"

**Options:** List each eligible folder path as an option (up to 4). If none found, announce: "No eligible post folders found. Run `/content-optimize` first to produce a publish-ready post."

Do not proceed until a valid folder is selected.

## Validation

Check that the selected folder contains the required artifacts:

1. `post.md` -- must exist, `status` frontmatter must be `publish-ready`, `aeo-optimized`, `polished`, or `revised`
2. `phases/01-topic-validation.yaml` -- must exist
3. `phases/02-keyword-research.yaml` -- must exist
4. `phases/03-serp-analysis.yaml` -- must exist (or contain `skipped: true` for trending)
5. `phases/05-outline-creation.yaml` -- must exist
6. `phases/08-seo-optimization.yaml` -- must exist
7. `phases/09-aeo-optimization.yaml` -- must exist
8. `outline.md` -- must exist

**If any required file is missing:** Announce which files are missing and suggest running the appropriate earlier orchestrator skill (`/content-optimize`). Do not proceed.

**If `phases/12-team-review.yaml` already exists:** Ask the user: "A revision report already exists. This means revising the already-revised version. Overwrite it or stop?"

### Overwrite Detection

If `post.md` frontmatter status is `draft` or `edited` (not an eligible post-pipeline status), warn:

"post.md status is '[status]', which indicates it may have been overwritten. Consider restoring from git: `git checkout HEAD -- path/to/post.md`. Proceed anyway or stop?"

## Context Loading

Load these files at the start of the revision session:

| File                                     | Purpose                                                 | Required |
| ---------------------------------------- | ------------------------------------------------------- | -------- |
| `post.md`                                | The post to revise                                      | Yes      |
| `outline.md`                             | Structural reference (heading budgets, hook type)       | Yes      |
| `phases/01-topic-validation.yaml`        | content_goal, content_timing                            | Yes      |
| `phases/02-keyword-research.yaml`        | Primary/secondary keywords                              | Yes      |
| `phases/05-outline-creation.yaml`        | Post type, word count target                            | Yes      |
| `phases/08-seo-optimization.yaml`        | SEO metadata, links                                     | Yes      |
| `phases/09-aeo-optimization.yaml`        | AEO headings, answer-first blocks                       | Yes      |
| `phases/11-polish.yaml`                  | What was already fixed in polish (avoid re-proposing)   | No       |
| `seed/keywords.txt`                      | Keyword density targets (skip density check if missing) | No       |
| `.content-style-guide.md` (project root) | Local style guide override                              | No       |

## Style Guide Loading

Load the style guide using the same dual-location merge as polish:

1. Read `.builder/skills/style-guide/references/default-voice-and-tone.md` directly
2. Check for `.content-style-guide.md` at the project root
3. If it exists, merge section-by-section: local `## Hard Rules` replaces default's, same for `## Voice Characteristics` and `## Phrases to Avoid`
4. The merged result is the active rule set for revision generation and the voice gate

---

## Feedback Input

Prompt the user to paste teammate feedback:

"Paste your teammate's feedback below. Expected format: quoted text (the highlighted passage) followed by a separator (-, --, or :) and then the comment. Separate items with blank lines."

### Parsing Rules

- Each item: quoted text (the highlighted passage) + separator (`-`, `--`, or `:`) + comment text
- Items separated by blank lines
- Quoted text is used to locate the target section in `post.md` via string matching
- If a quote cannot be found in `post.md` (e.g., Notion reformatted it, or polish changed the text), flag it during confirmation and ask the user to identify the section manually
- Non-actionable comments (e.g., "Looks good!", "Nice section") are identified during parsing and marked as "no action needed"

---

## Confirmation Step

Before processing, present the parsed list:

```
Feedback parsed: N items across M sections

  1. Introduction: "Developers can leverage..." -> Tone down, be specific
  2. Introduction: "revolutionary tool" -> Remove 'revolutionary'
  3. ## How Fast Is Claude Code?: "performance improvements..." -> Add benchmarks
  ! 4. [Quote not found]: "some text that changed during polish" -> Needs section ID

Proceed with these items?
```

Use **AskUserQuestion**:

**Question:** "Parsed N feedback items. Ready to proceed?"

**Options:**

1. **Start** -- Begin processing
2. **Re-paste** -- Paste feedback again (parsing was wrong)

If any items have unresolved section mappings (!), ask the user to identify the section for each before proceeding.

---

## Item-by-Item Processing

Process items **in the order pasted** -- simple, predictable, matches the user's mental model of their teammate's comment flow.

**Before processing each item:** Re-read `post.md` to ensure subsequent items see text updated by previous applied changes.

For each feedback item:

### Step 1: Show Context

Display the section heading, the quoted text with 2-3 surrounding sentences, and the teammate's comment.

### Step 2: Generate Revision

Generate a proposed change that addresses the feedback, using the loaded style guide and blog-writer voice. **Before presenting, run the Revision Voice Gate** (see below).

### Step 3: Present Revision

Show inline before/after with voice gate change log:

```
--- Item 1/10 ---
Section: Introduction

  BEFORE: Developers can leverage Claude Code to significantly
          enhance their workflow by automating repetitive tasks.

  AFTER:  Claude Code automates repetitive tasks -- file edits,
          test runs, git commits -- so you ship faster.

  Teammate: "This sounds too AI-ish. Tone it down and be more specific."
  Voice gate: 2 fixes applied (Rule 5 em dash removed, Rule 10 contraction)
```

Use **AskUserQuestion**:

**Question:** "Item N/total. Apply this revision?"

**Options:**

1. **Apply** -- Accept the proposed revision
2. **Modify** -- Provide instructions for a different revision
3. **Skip** -- Move to next item (marked as deferred in report)

### Step 4: Handle Modify

If the user selects "Modify": accept free-text instructions, regenerate the revision, run voice gate again, re-present the same 3 options. Loop until the user selects Apply or Skip.

### Step 5: Write Changes

Apply changes in-place to `post.md` after each approved item (consistent with polish).

---

## Revision Voice Gate (Mandatory)

Every auto-generated revision runs through a mandatory quality gate **before being presented to the user**. The revision comes from a model -- it is the highest-risk source of AI-voice reintroduction in the entire pipeline.

### Step 1: AI-Voice Vocabulary Scan

Scan the generated text against the full AI-voice detection reference (`.builder/skills/content-editing/references/ai-voice-detection.md`):

- **Category A** (13 phrases): "underscores," "showcasing," "aligns," "navigating," "landscape," "paradigm," etc.
- **Category B** (17 words + 7 academic-register defaults): "leverage," "utilize," "robust," "seamless," "comprehensive," "examines," "demonstrates," etc.
- **Category C** (9 hedge preambles): "It's worth noting that...," "In many cases...," etc.
- **Category D** (developer-specific): "Let's dive into," "Let's explore," "Happy coding!"

Auto-fix: Replace per the reference tables. Do not ask the user -- these are mechanical fixes.

### Step 2: Style Rule Micro-Scan

Check for violations of these rules (the five most reliably violated by AI-generated replacement text):

| Rule    | What to check                                                                                  | Auto-fix?                    |
| ------- | ---------------------------------------------------------------------------------------------- | ---------------------------- |
| Rule 5  | Em dashes (`---`, `--`) in prose                                                               | Yes -- restructure sentence  |
| Rule 9  | Filler adverbs: "very," "really," "actually," "basically," "essentially," "genuinely," "truly" | Yes -- cut                   |
| Rule 10 | Missing contractions: "do not," "it is," "you will" in prose                                   | Yes -- contract              |
| Rule 11 | Contrastive patterns: "not X, but Y," "It isn't X. It's Y."                                    | Yes -- rewrite affirmatively |
| Rule 13 | Colon-as-em-dash: "The key idea: use X"                                                        | Yes -- restructure           |

### Step 3: Scope-Dependent Checks

| Revision scope          | Additional checks                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| Touches introduction    | Rule 1 (no generic openings), Category D openers                                         |
| Touches conclusion      | Rule 7 (no "happy coding"), Category D closers, Rule 4 (specific CTA)                    |
| Contains a link         | Rule 16 (descriptive link text)                                                          |
| Contains a product name | Rule 15 (proper capitalization)                                                          |
| 2+ paragraphs           | Rule 3 (short paragraphs), Rule 12 (no rhetorical questions), Rule 6 (no hedge stacking) |

### Step 4: Overclaim and Hedge Detection

- Scan for absolute superlatives: "most [adj]," "highest [adj]," "best [adj]," "every [noun]" as claims about tools or people. Rewrite as comparatives.
- Scan for hedge verbs in advice: "may [verb]," "might [verb]," "could [verb]." Convert to direct recommendations.
- Scan for marketing abstractions: compound nouns with "velocity," "productivity," "synergy," "transformation." Replace with concrete feature descriptions.

### Step 5: Read-Aloud Test

Read the generated revision aloud (mentally). If it sounds like a Wikipedia article or press release rather than a developer talking to a peer, regenerate with tighter voice constraints.

### Gate Output

The voice gate produces a clean revision and a change log:

```
Voice gate: 3 fixes applied
  - "leverage" -> "use" (Category B)
  - "do not" -> "don't" (Rule 10)
  - "It's not about speed. It's about..." -> "Speed matters less than..." (Rule 11)
```

If the gate applies 5+ fixes, the revision is heavily AI-voiced. Regenerate with explicit constraints rather than patching.

---

## Factual Claims Verification

When a revision introduces or modifies factual claims, apply extra scrutiny:

- **AI model names/versions:** If the revision mentions GPT-_, Gemini _, Claude \*, or similar, run a WebSearch to verify the current version name before finalizing
- **Feature attribution for multi-product companies:** Verify that claimed features belong to the correct product tier (e.g., Claude Code CLI vs. claude.ai web)
- **Date-sensitive claims:** Flag year references, semver strings, and pricing figures for manual verification

This check is **advisory, not blocking** -- present the flags alongside the revision and let the user decide.

---

## SEO/AEO Re-Verification

After all items are processed, run a **lightweight integrity check** (matching polish's Step C):

- Answer-first blocks still present under AEO headings
- Quote-ready blocks still present
- Internal/external links not broken
- Heading keywords preserved
- Keyword density spot-check against `seed/keywords.txt` (if present; skip for trending posts)

Report as a single pass/fail with notes:

```
SEO/AEO check: pass
```

or:

```
SEO/AEO check: issues found
  - Answer-first block removed from "## How Do You Configure X?"
  - Heading keyword "server components" dropped from H2
Consider re-running /content-optimize for full verification.
```

---

## Revision Report

Write `phases/12-team-review.yaml`:

```yaml
total_items: 10
items_applied: 9
items_deferred: 1
word_count_before: 2180
word_count_after: 2240
seo_aeo_intact: true
seo_aeo_notes: ""
draft_md_synced: false

feedback_items:
  - id: 1
    quoted_text: "Developers can leverage Claude Code..."
    section: "Introduction"
    teammate_comment: "This sounds too AI-ish. Tone it down."
    disposition: "applied"
    change_summary: "Replaced formal register with direct language"
    voice_gate_fixes: 3

  - id: 2
    quoted_text: "The performance improvements are substantial"
    section: "## How Fast Is Claude Code?"
    teammate_comment: "Can we add actual benchmark numbers here?"
    disposition: "deferred"
    defer_reason: "Need to run benchmarks first"
    voice_gate_fixes: 0

status: revised
```

---

## Status Updates

After writing the revision report:

1. **`post.md` frontmatter:** Set `status: revised`
2. **`post.md` frontmatter:** Update `word_count` to the new count
3. **`metadata.yaml`:** Append revision summary:
   ```yaml
   revision_status: revised
   word_count_after_revision: 2240
   revision_items_applied: 9
   ```

---

## Pipeline Complete

Present a summary:

```
Revision complete!

Topic: [topic from Phase 1]
Title: [title from post.md]
Content Goal: [awareness/acquisition/hybrid]

Items applied: [N]
Items deferred: [N]
Word count: [before] -> [after]
SEO/AEO integrity: [pass/fail]

Output: [folder path]
+-- post.md               <- Revised post
+-- phases/12-team-review.yaml <- Revision report
+-- metadata.yaml         <- Updated with revision summary
```

### Next Steps

Use **AskUserQuestion** to present options:

**Question:** "Post is revised. What would you like to do next?"

**Options:**

1. **Re-polish** -- Run `/content-polish` on the revised post
2. **Capture learnings** -- Run `/content-compound` on this post
3. **Done** -- End the session

---

## Error Handling

### Style Guide Load Failure

If neither the project default style guide nor the local `.content-style-guide.md` override can be loaded:

1. Warn the user
2. Proceed without the voice gate's style-rule checks (Steps 2-3). AI-voice vocabulary scan (Step 1, Categories A-D) and overclaim/hedge detection (Step 4) still run.

### Quote Matching Failure

If a quoted passage cannot be found in `post.md`:

1. Flag during the confirmation step
2. Ask the user to identify the target section
3. If they cannot, skip the item as "unresolvable"

### File Write Failure

If writing to `post.md` fails:

1. Announce the error
2. Do not proceed to the next item
3. Suggest checking file permissions and disk space

### Session Interruption

Applied changes are already written to `post.md` in-place. Re-running the orchestrator skill and re-pasting the feedback will work -- already-applied items will produce "text not found" (the quoted text was changed) and can be skipped.

---

## Important Notes

- Revise is a post-pipeline orchestrator skill. It does not replace any Phase 1-10 step.
- `/content-blog --resume` ignores Phase 12 (revise is optional and post-pipeline).
- `/content-lfg` does NOT include revise (interactive by design, like polish).
- `revised` is a superset of `polished` and `publish-ready`. Any downstream orchestrator skill that accepts `publish-ready` or `polished` should also accept `revised`.
- Revise works on both new posts and refreshed posts (same eligibility as polish).
- Re-running revise on an already-revised post is safe (the report is overwritten, the post gets further refined).
- `draft.md` is NOT updated by revise. After Phase 8, `post.md` is canonical. Structural changes will leave `draft.md` diverged. The report records `draft_md_synced: false`.
