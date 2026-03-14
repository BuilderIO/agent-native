---
name: content-compound
description: "Captures pipeline learnings from a completed content generation run into searchable institutional knowledge. Use after finishing a blog post, when the user wants to document what worked, or when a process insight surfaces during content work."
---

# Capture Pipeline Learnings

Document what worked and what didn't during content creation. Produces a searchable compound doc in `docs/solutions/` and optionally updates the style guide or skills. Every learning captured makes the next content generation session better.

## Input

<input> $ARGUMENTS </input>

**If the input above is empty, ask the user:** "What would you like to document? You can provide:
1. A path to a post output folder (e.g., `output/posts/2026-02-08-react-server-components/`)
2. A path to a single markdown file
3. A description of what happened during content generation"

Do not proceed until you have input from the user.

## Input Validation

Determine the input type and extract context:

### Path to a directory
1. Look for `post.md` and `metadata.yaml` in the directory
2. Look for `phases/` subdirectory with phase artifacts
3. Read `metadata.yaml` to get pipeline status and key metadata
4. If `pipeline_status` is not `complete` or `status` is not one of `publish-ready`, `polished`, or `revised`, warn: "This post may not be finalized (status: [status]). Learnings from incomplete pipelines are still valuable. Continue?"

### Path to a single markdown file
1. Read the file
2. Check YAML frontmatter for `status` field
3. If status is not `publish-ready`, `polished`, `revised`, or later, warn the user
4. Look for a sibling `phases/` directory or `metadata.yaml` for additional context

### Free-text description
1. No file validation needed
2. The Learnings Capturer agent will work from the conversation context
3. Phase artifacts add specificity but are not required

---

## Invoke the Learnings Capturer

**Agent:** learnings-capturer

Pass the validated input to the Learnings Capturer agent. The agent runs its full workflow:

### Phase 1: Detect and Classify

The agent determines the learning type:
- **Pipeline problem** -- something went wrong during generation
- **Pipeline win** -- something went notably well
- **Process improvement** -- insight about the workflow itself
- **Style violation** -- voice/tone issue not caught by existing rules

### Phase 2: Gather Context

The agent extracts specifics from:

**Conversation context:**
- What happened (symptom)
- Which pipeline phase was involved (component)
- What was tried first (what didn't work)
- What resolved it (what worked)
- Why (root cause)
- How to prevent or replicate

**Phase artifacts (if the output folder was provided):**
- `phases/01-topic-validation.yaml` -- content goal, content timing
- `phases/02-keyword-research.yaml` -- Ahrefs unit count, keyword data
- `phases/05-outline-creation.yaml` -- revision count, hook type, post type
- `phases/07-content-editing.yaml` -- AI-voice violation count, compliance score
- `phases/08-seo-optimization.yaml` -- keyword placement gaps
- `phases/09-aeo-optimization.yaml` -- heading compliance ratio

If the agent cannot determine the symptom or component, it asks the user for clarification before proceeding.

### Phase 3: Document the Learning

The agent runs the Content Compound Docs skill's 7-step process:

1. Check existing docs in `docs/solutions/` for similar learnings
2. Generate filename: `[sanitized-lesson]-[component]-[YYYYMMDD].md`
3. Validate YAML against content-yaml-schema.md (blocking gate)
4. Create documentation using the content resolution template
5. Cross-reference similar docs; flag patterns at 3+ occurrences

### Phase 4: Present Decision Menu

After documentation, the agent presents options:

```
Learning documented.

File: docs/solutions/[category]/[filename].md

What's next?
1. Continue workflow (recommended)
2. Update style guide -- append rule to .content-style-guide.md
3. Link related learnings -- connect to existing compound docs
4. Update a skill -- modify a skill based on this learning
5. View documentation -- read the compound doc
```

### Phase 5: Execute Decision

**Option 2 (Update style guide):** The agent:
1. Reads the current `.content-style-guide.md`
2. Formulates a new rule from the learning
3. Checks for conflicts with existing rules
4. Presents the proposed rule for user approval
5. Appends to `.content-style-guide.md` if approved

**Option 4 (Update a skill):** The agent:
1. Identifies which skill to update based on the component
2. Proposes the specific change
3. Presents for user approval
4. Does NOT modify the skill directly -- presents the change for the user to apply

---

## Style Guide Update Triggers

The Learnings Capturer should proactively suggest a style guide update (Option 2) when:

- The learning reveals a voice consistency issue (`problem_type: voice_drift`)
- The learning reveals a structural pattern that should be codified
- The pattern has occurred 3+ times across learnings (pattern detection)

The user always approves before any style guide modification.

## Builder.io Product Knowledge Update Trigger

When the learning identifies a positioning gap (`problem_type: keyword_gap` or a new `positioning_context`), suggest:

"This post required positioning knowledge that wasn't in builder-capabilities.md. Run `/content-builder-update` to add it?"

This creates a virtuous cycle: write a post, discover a gap, update product knowledge, next post is better informed.

---

## Completion

After the decision menu is resolved, present a summary:

```
Learning captured!

Category: [category from docs/solutions/]
Problem type: [from YAML]
Component: [pipeline phase]
File: docs/solutions/[category]/[filename].md

Follow-up actions taken:
- [List any style guide updates, skill suggestions, or linked learnings]

Pattern alert: [If 3+ similar learnings exist, note the pattern]
```

## Error Handling

### Missing Phase Artifacts
If a post output folder is provided but phase artifacts are missing:
- Work from available artifacts and conversation context
- Note which artifacts were missing in the compound doc
- Do not fail -- partial context is still valuable

### YAML Validation Failure
If YAML validation fails (blocking gate in the compound docs process):
- Present the validation errors to the user
- Ask whether to fix the YAML fields or abandon
- The most common issue is an invalid enum value -- suggest the closest valid option

## Important Notes

- This command captures pipeline process learnings, not post-publish performance data. Traffic, rankings, and engagement are outside its scope.
- Phase artifacts add specificity but are not required. A verbal description of what happened is sufficient for the Learnings Capturer to work.
- The compound doc is written to `docs/solutions/[category]/` where category is determined by the YAML `category` field (e.g., `outline-issues/`, `voice-drift/`, `keyword-research/`).
- Pattern detection at 3+ similar learnings is a signal to update skills or the style guide, not an automatic action. The user decides.
