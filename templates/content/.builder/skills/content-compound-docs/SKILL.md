---
name: content-compound-docs
description: "This skill should be used when capturing learnings from the content generation pipeline to build searchable institutional knowledge. It covers the 7-step documentation process with YAML validation gates, content-specific problem categorization, and a post-capture decision menu. Invoked by the /content-compound orchestrator skill or during content generation when a process insight surfaces."
---

# Content Compound Docs

Capture learnings from the content generation pipeline as structured, searchable documentation. Each learning is a single markdown file in `docs/solutions/[category]/` with validated YAML frontmatter. Over time, this builds institutional knowledge that makes every future content generation session faster and better.

## When to Use This Skill

- During content generation when a pipeline phase produces unexpected results (good or bad)
- When the `/content-compound` orchestrator skill is invoked
- When a recurring process problem is identified across multiple content generation sessions
- When a pipeline approach works notably well and should be replicated
- When a style guide rule was violated that the pipeline didn't catch

## Prerequisites

- A content generation session with observable process insights
- Phase artifacts from the current or recent session (if available): `output/posts/YYYY-MM-DD-topic-slug/phases/`
- Access to `docs/solutions/` directory for storing learnings

## Process

### Step 1: Detect Trigger

**Auto-invoke after phrases:**
- "the outline needed work" / "outline took multiple revisions"
- "the hook type was wrong" / "that hook worked"
- "AI-voice detection caught a lot" / "voice was clean"
- "keyword research used too many units" / "Ahrefs budget was tight"
- "the content goal should have been different"
- "this pattern worked well"
- "the pipeline missed this"
- "we should document this"
- "that worked" / "that didn't work" / "lesson learned"

**Or manual:** `/content-compound` orchestrator skill

**Worth documenting when:**
- A pipeline phase required unexpected revisions or rework
- A pattern is emerging across 2+ content generation sessions
- A pipeline phase produced notably strong results (pipeline win)
- A style guide rule was violated that editing didn't catch
- Ahrefs unit usage was unexpectedly high or low
- A content goal or timing classification proved wrong during generation

**Skip documentation for:**
- Minor formatting fixes caught by the post-publish checklist
- One-off issues unlikely to recur
- Problems already documented in `docs/solutions/`

### Step 2: Gather Context

Extract from the conversation and any available phase artifacts:

**Required information:**
- **Post slug:** Which post is this about (or "general" for cross-session or pipeline-level learnings)
- **Symptom:** What was observed during content generation -- gate rejections, revision cycles, AI-voice violation counts, Ahrefs unit usage, word count issues
- **Component:** Which pipeline phase is most relevant
- **What didn't work:** Approaches tried during generation that failed (if applicable)
- **What worked:** The insight or change that made the difference
- **Root cause:** Why this happened in the pipeline
- **Prevention/replication:** How to avoid (for problems) or replicate (for wins)

**Phase artifacts to check (if available):**
- `phases/01-topic-validation.yaml` -- content goal, content timing
- `phases/02-keyword-research.yaml` -- keyword data, Ahrefs unit count
- `phases/05-outline-creation.yaml` -- revision count, hook type, post type
- `phases/07-content-editing.yaml` -- AI-voice violation count, word count, compliance score
- `phases/08-seo-optimization.yaml` -- keyword placement gaps, linking issues
- `phases/09-aeo-optimization.yaml` -- heading compliance ratio, answer-first block count

**Blocking requirement:** If the post slug, symptom, or component is unclear, ask and wait for a response before proceeding.

### Step 3: Check Existing Docs

Search `docs/solutions/` for similar learnings:

1. Search by keyword from the symptom description
2. Search by component name
3. Search by post slug (for multiple learnings from the same session)

**If similar learning found:** Present options:
1. Create new doc with cross-reference (recommended if different root cause)
2. Update existing doc (only if same root cause, same component)
3. Skip (already documented)

**If no similar learning found:** Proceed to Step 4.

### Step 4: Generate Filename

Format: `[sanitized-lesson]-[component]-[YYYYMMDD].md`

**Sanitization rules:**
- Lowercase
- Replace spaces with hyphens
- Remove special characters except hyphens
- Truncate to under 80 characters

**Examples:**
- `bold-claim-hook-wrong-for-tutorials-outline-creation-20260215.md`
- `ahrefs-unit-overspend-broad-topic-keyword-research-20260220.md`
- `ai-voice-clean-first-draft-blog-drafting-20260301.md`

### Step 5: Validate YAML Schema

**CRITICAL BLOCKING GATE.** All docs require validated YAML frontmatter.

Validate against [content-yaml-schema.md](./references/content-yaml-schema.md). Ensure:

1. All required fields present
2. Enum fields match allowed values exactly (case-sensitive)
3. `symptoms` is an array with 1-5 items
4. `date` matches YYYY-MM-DD format
5. `tags` are lowercase, hyphen-separated

**Block if validation fails:**

```
YAML validation failed:

Errors:
- problem_type: must be one of schema enums, got "bad_title"
- component: must be one of schema enums, got "writing"

Provide corrected values.
```

**Do NOT proceed to Step 6 until YAML passes all validation rules.**

### Step 6: Create Documentation

**Determine category** from `problem_type` using the category mapping in [content-yaml-schema.md](./references/content-yaml-schema.md).

**Create the documentation file:**

1. Create directory if needed: `docs/solutions/[category]/`
2. Populate [content-resolution-template.md](./assets/content-resolution-template.md) with context from Step 2 and validated YAML from Step 5
3. Write to `docs/solutions/[category]/[filename].md`

### Step 7: Cross-Reference and Pattern Detection

**If similar learnings found in Step 3:**
- Add a "Related Learnings" link to the similar doc
- Add a reciprocal link in the new doc

**Pattern detection:**
If this is the 3rd+ learning with the same `component` and `root_cause` combination, flag it:

```
Pattern detected: 3 learnings with component=blog_drafting, root_cause=weak_hook

Consider:
- Updating the blog-drafting skill with this pattern
- Adding a hard rule to the style guide
- Creating a checklist item in the post-publish checklist
```

Do not auto-update skills. Present the pattern and let the user decide via the decision menu.

## Decision Menu After Capture

After successful documentation, present options:

```
Learning documented.

File: docs/solutions/[category]/[filename].md

What's next?
1. Continue workflow (recommended)
2. Update style guide -- append rule to .content-style-guide.md
3. Link related learnings -- connect to similar docs
4. Update a skill -- add guidance to an existing skill
5. View documentation -- see what was captured
6. Other
```

**Option 1: Continue workflow** -- Return to calling orchestrator skill. Documentation is complete.

**Option 2: Update style guide** -- Present the learning as a candidate rule. Ask whether it belongs in the project default (`.builder/skills/style-guide/references/default-voice-and-tone.md`) or the local override (`.content-style-guide.md`). Format as a Hard Rule if severity is critical, or as a guideline otherwise.

**Option 3: Link related learnings** -- Search `docs/solutions/` for the target doc. Add cross-references in both directions.

**Option 4: Update a skill** -- Ask which skill to update. Add the learning as a guideline or checklist item to the skill's SKILL.md.

**Option 5: View documentation** -- Display the created file. Present the decision menu again.

## Examples

### Example 1: Outline Required Multiple Revisions

**Trigger:** "The outline needed 3 revisions -- the Bold Claim hook was wrong for a tutorial post."

**Step 2 context:**
- Post slug: `react-server-components-guide`
- Symptom: Outline required 3 revision cycles at Gate 2, hook type mismatch
- Component: `outline_creation`
- Root cause: `weak_hook` -- Bold Claim hooks don't fit tutorial posts; Problem or Question hooks are better
- Resolution: `skill_update` -- add hook-to-post-type guidance to outline-creation skill

**Step 5 YAML:**
```yaml
post_slug: react-server-components-guide
date: 2026-02-15
problem_type: outline_issue
component: outline_creation
symptoms:
  - "Outline required 3 revision cycles at Gate 2"
  - "Bold Claim hook was wrong fit for tutorial post type"
  - "Section flow improved after switching to Problem hook"
root_cause: weak_hook
content_goal: awareness
content_timing: evergreen
resolution_type: skill_update
severity: medium
tags: [hook-selection, tutorial, outline-revision]
```

**File created:** `docs/solutions/outline-issues/bold-claim-hook-wrong-for-tutorials-outline-creation-20260215.md`

### Example 2: Clean First Draft (Pipeline Win)

**Trigger:** "The AI-voice pass found 0 violations. The draft was clean on the first pass."

**Step 2 context:**
- Post slug: `react-server-components-guide`
- Symptom: AI-voice Pass 3 found 0 violations, draft passed Gate 3 first attempt
- Component: `blog_drafting`
- Root cause: `effective_pattern` -- following style guide hard rules during drafting prevented AI-voice patterns
- Resolution: `no_action` -- record the pattern for future use

**Step 5 YAML:**
```yaml
post_slug: react-server-components-guide
date: 2026-02-15
problem_type: pipeline_win
component: blog_drafting
symptoms:
  - "AI-voice Pass 3 found 0 violations in first draft"
  - "Draft passed Gate 3 on first attempt"
  - "Word count hit 2,180 -- within target range with buffer for AEO"
root_cause: effective_pattern
content_goal: awareness
content_timing: evergreen
resolution_type: no_action
severity: low
tags: [clean-draft, ai-voice, word-count-discipline]
```

**File created:** `docs/solutions/pipeline-wins/ai-voice-clean-first-draft-blog-drafting-20260215.md`

### Example 3: Style Violation Leading to Style Guide Update

**Trigger:** "The last three posts all used 'under the hood' more than once."

**Step 2 context:**
- Post slug: general (cross-session learning)
- Symptom: Phrase "under the hood" appears 3+ times in recent drafts
- Component: `style_guide`
- Root cause: `voice_drift`

**Decision menu selection:** Option 2 (Update style guide)

**Action:** Append to `.content-style-guide.md`:
```markdown
## Phrases to Avoid
- "under the hood" -- limit to once per post maximum
```

**File created:** `docs/solutions/style-violations/under-the-hood-overuse-style-guide-20260220.md`

### Example 4: Ahrefs Unit Overspend

**Trigger:** "Keyword research used 800 Ahrefs units -- that's too many for a narrow topic."

**Step 2 context:**
- Post slug: general (pipeline-level learning)
- Symptom: 800 Ahrefs units consumed during keyword research for a narrow topic
- Component: `keyword_research`
- Root cause: `ahrefs_budget` -- broad keyword explorers returned mostly irrelevant results
- Resolution: `skill_update` -- add guidance to narrow keyword explorers for focused topics

**Step 5 YAML:**
```yaml
post_slug: general
date: 2026-02-20
problem_type: process_improvement
component: keyword_research
symptoms:
  - "Keyword research used 800 Ahrefs units for a narrow topic"
  - "Most units spent on broad explorers that returned irrelevant results"
root_cause: ahrefs_budget
resolution_type: skill_update
severity: medium
tags: [ahrefs-budget, keyword-research, unit-efficiency]
```

**File created:** `docs/solutions/process-improvements/ahrefs-unit-overspend-broad-topic-keyword-research-20260220.md`

## Guidelines

- Capture learnings while context is fresh. Document during or immediately after the content generation session, not weeks later.
- Pipeline wins are as valuable as failures. Documenting what worked builds a playbook; documenting only failures builds a list of warnings.
- The YAML validation gate is non-negotiable. Invalid YAML means the learning is not searchable. Block until valid.
- Pattern detection (3+ similar learnings) is a strong signal to update a skill or style guide rule. Surface it, but let the user decide.
- The decision menu is not a formality. Option 2 (update style guide) and Option 4 (update a skill) are the mechanism by which learnings flow back into the pipeline and improve future content generation.
- Keep learnings specific and actionable. "The hook was bad" is not searchable. "Bold Claim hooks with specific metrics require evidence the writer has (benchmark data, case study results) -- for tutorial posts where the writer is teaching, Problem or Question hooks work better" is.
