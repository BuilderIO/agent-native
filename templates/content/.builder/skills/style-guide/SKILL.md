---
name: style-guide
description: "This skill should be used when reading, merging, or applying voice and tone rules during drafting and editing. It covers the dual-location style guide architecture (project default + local override), the merge order, the structured rule format, voice violation taxonomy, and severity classification. Referenced by Phases 6, 7, and 17."
---

# Style Guide

Load, merge, and apply voice and tone rules from the dual-location style guide system. This skill does not produce output artifacts -- it provides the rules that other skills (Blog Drafting, Content Editing) consume.

## When to Use This Skill

- During Phase 6 (Blog Drafting) to set voice and tone for the first draft
- During Phase 7 (Content Editing) to evaluate voice compliance in Pass 3 and Pass 4
- When the `/content-style-update` orchestrator skill adds or modifies rules
- When resolving voice-related feedback on a draft

## Prerequisites

- Project default rules at [default-voice-and-tone.md](./references/default-voice-and-tone.md) (bundled with project)
- Link text rules at [link-text-rules.md](./references/link-text-rules.md) (bundled with project)
- Optional: local override at `.content-style-guide.md` in the project root

## Architecture

### Dual-Location System

Style rules live in two places:

1. **Project default** -- `.builder/skills/style-guide/references/default-voice-and-tone.md`. Bundled with the project. Contains the baseline voice, hard rules, formatting conventions, and content rules. Updated via `/content-style-update` when a rule applies globally.

2. **Local override** -- `.content-style-guide.md` at the project root. Project-specific rules that override or extend the default. Updated via `/content-style-update` when a rule applies to the current project only.

### Merge Order

```
Project default  ->  Local override (.content-style-guide.md)
```

Most specific wins. The merge is section-by-section:

- If the local file has a `## Voice Characteristics` section, it **replaces** the default's Voice Characteristics entirely.
- If the local file has a `## Hard Rules` section, it **replaces** the default's Hard Rules entirely.
- If a section exists only in the default, it carries through unchanged.
- If a section exists only in the local file, it is added.

This means a local file with only `## Phrases to Avoid` inherits everything else from the default and adds its own phrases section.

### Rule Format

Each section in the style guide follows a consistent structure. See [default-voice-and-tone.md](./references/default-voice-and-tone.md) for the full reference.

**Sections:**

| Section                 | Purpose                                                 | Format                                       |
| ----------------------- | ------------------------------------------------------- | -------------------------------------------- |
| Voice Characteristics   | Tone descriptors and voice principles                   | Bullet list with bold lead + explanation     |
| Hard Rules              | Violations that must be fixed before publish            | Numbered table: Rule, Detection Pattern, Fix |
| Formatting              | Paragraph length, heading frequency, code blocks, lists | Bullet list with bold lead + rule            |
| Content Rules           | Word count, link counts, code ratio, hook/conclusion    | Bullet list with bold lead + rule            |
| Phrases to Avoid        | Banned phrases with suggested replacements              | Bullet list                                  |
| Formal Verbs to Replace | Academic verbs to swap for conversational alternatives  | Table: Formal Verb, Alternative              |
| Unnecessary Qualifiers  | Qualifiers that add false precision                     | Bullet list                                  |

## Process

### Step 1: Load the Default Rules

Read [default-voice-and-tone.md](./references/default-voice-and-tone.md). This file contains 5 sections: Voice Characteristics, Hard Rules, Formatting, Content Rules, Voice Violation Taxonomy, and Severity Classification.

### Step 2: Check for Local Override

Check if `.content-style-guide.md` exists at the project root.

- If it does not exist, use the default rules as-is. Proceed to Step 4.
- If it exists but sections are placeholder text (e.g., `[Add rules here via /content-style-update]`), treat those sections as empty and fall through to the default.

### Step 3: Merge Rules

For each section in the local override:

1. If the section has real content (not placeholder), it **replaces** the corresponding default section.
2. If the section is empty or placeholder, the default section carries through.
3. If the local file has sections not in the default (e.g., `## Phrases to Avoid`), add them.

The merged result is the active style guide for this session.

### Step 4: Apply Rules to the Current Task

How the merged rules are used depends on which phase is calling:

**Phase 6 (Blog Drafting):**

- Voice Characteristics guide tone and word choice during drafting
- Hard Rules are constraints to follow while writing (not violations to catch after)
- Formatting rules set paragraph length, heading frequency, code block standards
- Content Rules set word count target, link counts, hook/conclusion requirements

**Phase 7 (Content Editing):**

- Hard Rules become the checklist for Pass 1 (Clarity) and Pass 4 (Engagement)
- Voice Violation Taxonomy drives Pass 3 (AI-Voice Detection) alongside [ai-voice-detection.md](../content-editing/references/ai-voice-detection.md)
- Severity Classification determines issue categorization in the editing report

**`/content-style-update` orchestrator skill:**

- Read the current merged rules
- Present the proposed new rule alongside any conflicting existing rule
- If conflict detected, ask the user which to keep
- Write the new rule to either the default (global) or local override (project-specific)

### Step 5: Report Active Rules

When another skill requests the style guide, return:

```yaml
style_guide_source:
  default: .builder/skills/style-guide/references/default-voice-and-tone.md
  local_override: .content-style-guide.md # or "none"
  sections_overridden: [] # list of section names replaced by local file
  active_rules_count:
    voice_characteristics: 5
    hard_rules: 24
    formatting: 7
    content_rules: 6
    phrases_to_avoid: 5
    formal_verbs_to_replace: 5
    unnecessary_qualifiers: 3
```

This lets downstream skills know which rules are active and where they came from.

## Voice Violation Taxonomy

Three failure modes with detection patterns and fixes. See [default-voice-and-tone.md](./references/default-voice-and-tone.md) for the full tables.

| Failure Mode    | Signal                                                         | Quick Fix                                                |
| --------------- | -------------------------------------------------------------- | -------------------------------------------------------- |
| **Too Formal**  | Third person, passive clusters, no contractions, Latin phrases | Use "you"/"I", active voice, contract naturally          |
| **Too Casual**  | Slang, run-on sentences, no structure, excessive exclamation   | Moderate informal language, add subheadings and evidence |
| **Too Preachy** | "You should always...", moral framing, assumed ignorance       | Share experience, back claims with evidence              |

## Severity Classification

| Severity      | Action                  | Applies To                                |
| ------------- | ----------------------- | ----------------------------------------- |
| **Critical**  | Must fix before publish | Hard rule violations, factual errors      |
| **Important** | Should fix              | Voice drift, weak CTAs, missing links     |
| **Minor**     | Consider                | Paragraph rhythm, transition improvements |
| **Praise**    | Record in compound docs | Effective patterns to reinforce           |

## Examples

### Example 1: Default-Only Merge

No `.content-style-guide.md` exists (or file is all placeholders).

**Input:** Phase 6 requests style rules.

**Result:** All rules from `default-voice-and-tone.md` apply. Voice is conversational developer-to-developer, 24 hard rules active, 2,200 word target, 2-3 internal + 2-3 external links.

### Example 2: Local Override with Phrases to Avoid

`.content-style-guide.md` contains:

```markdown
## Phrases to Avoid

- "at the end of the day" -- overused in Vishwas's drafts
- "under the hood" -- fine once per post, not more
```

**Result:** All default sections carry through unchanged. The local `Phrases to Avoid` section is added on top. During editing, these phrases are flagged as Important issues.

### Example 3: Local Override Replacing Hard Rules

`.content-style-guide.md` contains:

```markdown
## Hard Rules

| #   | Rule                       | Detection Pattern           | Fix                          |
| --- | -------------------------- | --------------------------- | ---------------------------- |
| 1   | No generic openings        | "In this article..."        | Jump into the topic          |
| 2   | Maximum 1 em dash per post | Any em dash after the first | Replace with comma or period |
```

**Result:** The default's 24 hard rules are **replaced** by these 2 local rules. All other default sections (Voice Characteristics, Formatting, Content Rules) still apply.

### Example 4: Conflict Detection During Style Update

User runs `/content-style-update` to add: "Allow up to 4 em dashes per post."

**Existing rule (Hard Rule #5):** "No em dash excess -- >2 em dashes per post."

**Action:** Present both rules to the user:

- **Existing:** Max 2 em dashes per post
- **Proposed:** Allow up to 4 em dashes per post

Ask which to keep. Update the chosen location (default or local) with the winner.

### Example 5: Severity in Practice

| Issue Found                                                       | Severity  | Why                                                       |
| ----------------------------------------------------------------- | --------- | --------------------------------------------------------- |
| Opening line is "In this comprehensive guide, we will explore..." | Critical  | Hard Rule #1 (generic opening) + Hard Rule #2 (AI phrase) |
| Paragraph with 5 sentences                                        | Important | Hard Rule #3 (>3 sentences)                               |
| A transition between sections feels abrupt                        | Minor     | Polish-level -- doesn't violate a rule                    |
| Hook uses a specific benchmark number from the post's research    | Praise    | Strong example of "specific over vague"                   |

## Guidelines

- The style guide is a living document. Rules get added, modified, and removed over time via `/content-style-update` and `/content-compound`.
- Default rules reflect cross-project voice. Local rules reflect project-specific preferences. When in doubt about where a new rule belongs, start local -- promote to default after it proves useful across 3+ posts.
- The style guide does not replace the AI-voice detection reference. The two complement each other: the style guide defines the target voice; AI-voice detection catches the anti-patterns. Both are used during editing.
- Do not over-specify. A style guide with 50 hard rules is a style guide nobody reads. Keep hard rules to the violations that most damage reader trust. Everything else is a guideline.
- Praise entries in compound docs are as valuable as violation entries. They tell future drafts what to do, not just what to avoid.
