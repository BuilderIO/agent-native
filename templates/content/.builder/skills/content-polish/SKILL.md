---
name: content-polish
description: "Performs section-by-section editorial polish with style guide enforcement. Use when the user wants voice/tone cleanup, style enforcement, or a final editing pass before publishing."
---

# Polish Pipeline

Run a section-by-section editorial polish on a post that has completed the full pipeline (Phases 1-10). Enforces style guide micro-rules, preserves SurferSEO keyword density, verifies SEO/AEO integrity, and accommodates user observations. Interactive -- one section at a time with approval.

## Input

<folder> $ARGUMENTS </folder>

**If the folder above is empty:** Scan `output/posts/` for folders that have phases 01-10 complete and contain `post.md`. List eligible folders using **AskUserQuestion**:

**Question:** "Which post folder do you want to polish?"

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

**If any required file is missing:** Announce which files are missing and suggest running the appropriate earlier command (`/content-optimize`). Do not proceed.

**If `phases/11-polish.yaml` already exists:** Ask the user: "A polish report already exists in this folder. This means polishing the already-polished version. Overwrite it or stop?"

## Context Loading

Load these files at the start of the polish session:

| File | Purpose | Required |
|------|---------|----------|
| `post.md` | The post to polish | Yes |
| `outline.md` | Structural reference (heading budgets, hook type) | Yes |
| `phases/01-topic-validation.yaml` | content_goal, content_timing | Yes |
| `phases/02-keyword-research.yaml` | Primary/secondary keywords | Yes |
| `phases/05-outline-creation.yaml` | Post type, word count target | Yes |
| `phases/08-seo-optimization.yaml` | SEO metadata, internal/external links | Yes |
| `phases/09-aeo-optimization.yaml` | AEO headings, answer-first blocks, quote-ready blocks | Yes |
| `seed/keywords.txt` | SurferSEO keyword density targets | No (if missing, skip density checks) |
| `seed/ai-search.txt` | AI search queries and raw facts | No (if missing, skip AI search checks) |
| `.content-style-guide.md` (project root) | Local style guide override | No (use project default if missing) |

**Keyword file format:** `seed/keywords.txt` uses `keyword phrase: min-max` per line (e.g., `cursor and claude code: 4-8`). If the file contains only plain keywords (one per line, no ranges), skip density threshold checks and report raw counts only.

## Content Goal Routing

Read `content_goal` and `content_timing` from `phases/01-topic-validation.yaml`.

**Content goal behavior:**

| Content Goal | Polish Behavior |
|-------------|-----------------|
| `awareness` | Standard micro-rules. Flag any promotional Builder.io mentions that crept in (product pitches, dedicated sections, CTAs). Internal links to Builder.io blog posts are fine. |
| `acquisition` | Standard micro-rules. Builder.io integration section receives standard style checks but preserve product messaging intent. |
| `hybrid` | Standard micro-rules. Verify Builder.io CTA remains in conclusion only, not scattered in body sections. |

**Trending mode:**

| Aspect | Behavior |
|--------|----------|
| Style guide micro-rules | Full enforcement (AI patterns must be caught regardless of timing) |
| Keyword density | Skip if no `seed/keywords.txt` (trending posts often have no SurferSEO data) |
| SEO/AEO integrity | Full checks (AEO is especially important for trending topics) |

**Comparison post detection:** Read `post_type` from `phases/05-outline-creation.yaml`. If the post is a comparison type, flag extra Rule 11 (contrastive pattern) vigilance -- comparison structure naturally invites "but", "not", negative framing.

---

## Feedback Ledger

The feedback ledger is a session-scoped list of editorial patterns that accumulates as the user interacts with each section. It enables forward propagation: feedback given on Section N automatically flags matching patterns in Sections N+1, N+2, etc.

### Ledger Entry Format

Each entry contains:
- **label**: Short description (e.g., "Overclaim softening")
- **search_terms**: List of strings/patterns to scan for (e.g., ["most valuable", "highest-leverage", "most important"])
- **action**: What to do when found (e.g., "Replace with comparative framing")
- **source_section**: Which section triggered the entry
- **type**: `user_feedback` (from My edits/My feedback) or `suppression` (from repeated rejections)

### How Entries Are Created

**From "My edits" or "My feedback":**

When the user provides observations, extract the underlying editorial principle and create a ledger entry. Ask the user to confirm the extracted pattern before adding it to the ledger:

"I'll watch for this pattern in future sections:
- Pattern: [label]
- Looking for: [search_terms]
- Action: [action]

Does this capture your intent?"

Use **AskUserQuestion**:

**Question:** "Add this pattern to the feedback ledger for future sections?"

**Options:**
1. **Yes** -- Add to ledger
2. **Adjust** -- User refines the pattern (via free text)
3. **Skip** -- Don't add to ledger (one-off fix only)

**If "Adjust":** User provides refined pattern via free text. Update the entry and add to ledger without re-asking.

**From selective rejections:**

When the user applies edits selectively (Step E "Apply selectively"), track which rule categories were rejected. If the same rule category is rejected 2 or more times across any sections, prompt:

Use **AskUserQuestion**:

**Question:** "You've skipped [Rule X] edits twice now. Want me to stop flagging these?"

**Options:**
1. **Yes, stop flagging** -- Add suppression entry to ledger
2. **No, keep flagging** -- Continue proposing these edits
3. **Case by case** -- No ledger entry (keep deciding per instance)

### Initialization

The ledger starts empty at session start. It persists for the duration of the polish session only. It is NOT written to disk as a separate file -- it lives in the session context and is recorded in the final `phases/11-polish.yaml` report.

---

## Section-by-Section Polish

Strip YAML frontmatter (everything between opening `---` and closing `---`) before sectioning. Frontmatter is non-editable content -- only modified during the final audit (status, word_count). Exclude fenced code blocks (` ``` `) and inline code from style rule scanning.

Split the remaining body on H2 headings. Label sections as:
- **"Introduction"** -- text before the first H2 (may be empty if post starts with H2)
- **"[H2 heading text]"** -- each H2 section including its content up to the next H2
- **"Conclusion"** -- text after the last H2 if it exists separately; if the last H2 IS the conclusion (e.g., `## Conclusion`), treat it as a regular H2 section

For each section, run these steps:

### Step 0: Feedback Ledger Scan

If the feedback ledger is non-empty:
1. For each `user_feedback` entry: scan the section text for any search_terms matches (case-insensitive)
2. For each match: create a proposed edit with a `[Prior feedback]` prefix and the entry's action as the recommendation
3. For each `suppression` entry: if the corresponding rule would normally flag something in this section, suppress it (do not include in the Step A proposed edits list)

Ledger-sourced edits appear first in Step D, before standard rule-based edits, to give them priority visibility.

If the feedback ledger is empty (e.g., first section), skip this step.

### Step A: Style Guide Micro-Rules Scan

Run these checks against the section text (from content-editing Step 4b + style guide hard rules). Exclude code blocks and inline code.

| Rule | Search Pattern | Action |
|------|---------------|--------|
| Rule 3 (short paragraphs) | Paragraphs with >3 sentences | Split at idea boundaries |
| Rule 5 (em dashes) | `---`, `—` in prose (not code) | Replace with period, comma, or restructure |
| Rule 9 (filler adverbs) | "very", "really", "actually", "basically", "essentially", "genuinely", "truly" | Cut or replace with specific detail |
| Rule 10 (contractions) | "do not", "it is", "you will", "cannot" in running prose (not code) | Contract: "don't", "it's", "you'll", "can't" |
| Rule 11 (contrastive) | "but ", "not ", "no ", "lack", "without ", "instead of", "rather than" in contrastive frame | Rewrite affirmatively |
| Rule 12 (rhetorical questions) | Sentences ending with "?" that are not H2/H3 AEO headings | Rewrite as statements |
| Rule 13 (colon-as-em-dash) | Colons in prose (not code, not lists) introducing a restatement | Restructure to flow naturally |
| Rule 15 (product name caps) | Lowercase product names placed for keyword density | Capitalize proper nouns while preserving keyword |
| AI-voice (Category A-D) | Patterns from ai-voice-detection.md reference | Replace or cut per category tables |
| Redundancy | Duplicate or near-duplicate sentences within the section | Flag for removal |

### Step B: Keyword Density Check (if seed/keywords.txt exists)

For each proposed edit in Step A, check if it removes or changes a keyword instance. If it does:
- Count remaining occurrences of that keyword in the full post (re-read from the current state of `post.md`, which reflects all previously applied edits)
- Compare against the target range from seed/keywords.txt
- If the edit would drop the keyword below the target minimum, flag it: "This edit removes 1 instance of '[keyword]'. Current count: N, target: M-P. Consider preserving the keyword in the rewrite."

**Case-insensitive note:** SurferSEO counts keywords case-insensitively. Capitalizing product names (Rule 15) does not reduce keyword count. Note this when presenting Rule 15 fixes alongside keyword density data.

### Step C: SEO/AEO Integrity Check

Quick verification that the section still has:
- Answer-first block intact (if this is an AEO heading section)
- Quote-ready blocks intact (standalone, concise answers)
- Internal/external links preserved
- Heading keywords preserved (if heading was chosen for keyword density)

### Step D: Present Proposed Edits

**If the section has zero proposed edits** (no Step 0 ledger matches, no Step A violations, no Step B/C issues):

Present the section text and announce: "Section: [heading] -- no violations detected."

Use **AskUserQuestion**:

**Question:** "Section: [H2 heading]. No issues found. Want to review?"

**Options:**
1. **Move on** -- Advance to next section
2. **My feedback** -- Provide observations for this section (added to ledger for future sections)

If "My feedback": follow the same flow as "My edits" in Step E below.

**If the section has proposed edits**, show the user:
1. A numbered list of proposed changes with before/after for each (ledger-sourced edits marked `[Prior feedback]` appear first)
2. Any keyword density warnings
3. Any SEO/AEO integrity notes

### Step E: User Decision

Use **AskUserQuestion**:

**Question:** "Section: [H2 heading]. [N] edits proposed. How do you want to proceed?"

**Options:**
1. **Apply all** -- Apply all proposed edits
2. **Apply selectively** -- User specifies which edits to apply (comma-separated numbers, e.g., "1, 3, 5")
3. **Skip** -- Move to next section without changes
4. **My edits** -- User provides their own observations for this section (word tweaks, reframing, additions). Apply user edits, then re-run style/keyword checks on the result.

**If "Apply selectively":** User provides edit numbers via the Other/free-text option. Invalid numbers are ignored with a warning. Apply only the specified edits. Track which rule categories were rejected (skipped edits). If the same rule category is rejected 2+ times across any sections, trigger the suppression prompt from the Feedback Ledger section above.

**If "My edits" or "My feedback":** After applying user changes:
1. Re-run Steps A-C on the modified section to catch any new violations introduced. Present any new findings. Loop until clean or user says "move on."
2. After the section is finalized, extract the editorial principle behind the user's changes and propose a ledger entry using the confirmation flow from the Feedback Ledger section above. If the user's changes are purely mechanical (typo fixes, word swaps with no pattern), skip the ledger extraction.

**Stop mid-session:** The user can say "stop" via the Other/free-text option at any time. Since edits are applied to `post.md` in-place after each section's approval, all progress is preserved. The user can re-run `/content-polish` to continue -- previously polished sections will be re-scanned (clean sections present the "no issues" prompt, sections with new ledger matches will surface them).

After applying edits (or skipping), write the changes to `post.md` in-place and advance to the next section.

---

## Final Audit

After all sections are polished:

1. **Full keyword density report** (if seed/keywords.txt exists): count every target keyword in the polished post (excluding frontmatter, including code blocks since SurferSEO counts rendered page content). Show a table: keyword, current count, target range, status (OK / under / over).

2. **Word count update:** Count words in polished `post.md` (excluding frontmatter and code blocks). Update frontmatter `word_count`.

3. **Frontmatter update:** Set `status: polished`.

4. **metadata.yaml update:** Append polish summary to the existing `metadata.yaml`:
   ```yaml
   polish_status: polished
   polish_edits_applied: 21
   word_count_after_polish: 3480
   ```

---

## Polish Report

Write `phases/11-polish.yaml`:

```yaml
sections_polished: 8
sections_reviewed_clean: 2
total_edits_proposed: 24
total_edits_applied: 21
total_user_custom_edits: 3
total_ledger_sourced_edits: 4
style_guide_fixes:
  rule_3_long_paragraphs: 2
  rule_5_em_dashes: 1
  rule_9_filler_adverbs: 3
  rule_10_contractions: 1
  rule_11_contrastive: 8
  rule_12_rhetorical_questions: 2
  rule_13_colon_as_em_dash: 2
  rule_15_product_name_caps: 4
  ai_voice_patterns: 3
  redundancy: 1
keyword_density_warnings: 2
keyword_density_final:
  - keyword: "cursor and claude code"
    count: 5
    target: "4-8"
    status: ok
  - keyword: "ai coding tools"
    count: 3
    target: "3-6"
    status: ok
seo_aeo_integrity: pass
word_count_before: 3550
word_count_after: 3480
feedback_ledger:
  entries:
    - label: "Overclaim softening"
      search_terms: ["most valuable", "highest-leverage", "most important"]
      action: "Replace with comparative framing ('have an edge')"
      source_section: "Introduction"
      type: user_feedback
      sections_matched: ["H2-1", "Conclusion"]
    - label: "Rule 11 suppressed"
      search_terms: []
      action: "User prefers contrastive framing -- do not flag"
      source_section: "H2-2"
      type: suppression
      sections_suppressed: ["H2-3", "H2-4", "FAQ"]
  total_user_feedback_entries: 1
  total_suppression_entries: 1
  total_forward_matches: 2
status: polished
```

---

## Pipeline Complete

When the final audit finishes, present a summary:

```
Polish complete!

Topic: [topic from Phase 1]
Title: [title from post.md]
Content Goal: [awareness/acquisition/hybrid]

Sections polished: [N] / [total]
Sections reviewed clean: [N] (no violations, user reviewed)
Edits applied: [N] proposed + [N] user custom + [N] ledger-sourced
Word count: [before] → [after]

Style fixes:
  Contrastive patterns: [N]
  Product name caps: [N]
  Filler adverbs: [N]
  AI-voice patterns: [N]
  Other micro-rules: [N]

Feedback propagation:
  Patterns tracked: [N]
  Forward matches flagged: [N]
  Rules suppressed: [N]

Keyword density: [all OK / N warnings]
SEO/AEO integrity: [pass/fail]

Output: [folder path]
├── post.md           ← Polished post
├── phases/11-polish.yaml ← Polish report
└── metadata.yaml     ← Updated with polish summary
```

### Next Steps

Use **AskUserQuestion** to present options:

**Question:** "Post is polished. What would you like to do next?"

**Options:**
1. **Resolve teammate feedback** -- Run `/content-revise` to address teammate comments
2. **Capture learnings** -- Run `/content-compound` on this post to document what worked and what didn't
3. **View the post** -- Read `post.md` for final review
4. **Done** -- End the session

---

## Error Handling

### Style Guide Load Failure
If neither the project default style guide nor the local `.content-style-guide.md` override can be loaded:
1. Announce the failure to the user
2. Stop the pipeline -- polish cannot run without style guide rules

### File Write Failure
If `post.md` cannot be written after a section:
1. Announce the failure
2. Stop the pipeline
3. Progress up to the last successful write is preserved in `post.md`

### Malformed Seed Keywords
If `seed/keywords.txt` cannot be parsed:
1. Warn the user: "Could not parse seed/keywords.txt. Skipping keyword density checks."
2. Continue the polish loop without density checks

### Section Loop Interruption
If the user stops mid-session or the context window is exhausted:
- All edits applied up to the last completed section are preserved in `post.md`
- Re-running `/content-polish` on the same folder will re-scan all sections (the feedback ledger is session-scoped and does not persist across sessions, so all sections are re-evaluated fresh)
- Previously applied edits remain in `post.md`, so clean sections will present "no issues" and the user can move on quickly

## Important Notes

- Polish is post-pipeline. It does not replace any phase (1-10). The pipeline considers Phase 10 as the terminus.
- `/content-blog --resume` ignores Phase 11. Polish is an optional post-pipeline step.
- `/content-lfg` does not include polish. Polish is interactive by design.
- `polished` is a superset of `publish-ready`. A polished post is publish-ready. Commands that check for `publish-ready` status should also accept `polished`.
- Polish works on both new posts and refreshed posts (`/content-refresh`). Same folder structure, same behavior.
- Polish is compatible with `/content-compound` -- learnings from the polish session can be captured afterward.
- Factual verification is not in polish scope. Factual claims are verified by Phase 10 Step 8b (Factual Claims Verification). The user's "My edits" option allows them to flag and fix factual issues per section during the polish session if they spot any.
- Re-running polish on an already-polished post is safe. The second pass will find fewer violations (since the first pass fixed them). Clean sections will show "no issues" with the option to move on or provide feedback.
- The feedback ledger is session-scoped. It does not persist across sessions. Each polish session starts with a fresh ledger. Ledger contents are recorded in `phases/11-polish.yaml` for reference.
