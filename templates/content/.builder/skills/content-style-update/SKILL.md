---
name: content-style-update
description: "Updates the style guide from editorial corrections or new writing rules. Use when the user wants to add, modify, or enforce voice/tone rules, or when editorial corrections reveal a missing style rule."
---

# Update Style Guide

Extract editorial corrections, formulate structured rules, and append them to `.content-style-guide.md` (local override). Every rule added here improves all future posts.

## Input

<input> $ARGUMENTS </input>

**If the input above is empty, ask the user:** "What style correction do you want to add? You can provide:
1. A correction in plain text (e.g., \"Never use 'In this article we will explore' -- jump directly into the topic\")
2. A path to a post with inline corrections or comments"

Do not proceed until you have input from the user.

## Input Validation

Determine the input type:

### Free-text correction
The input is a verbal correction. Proceed directly to rule formulation.

### Path to a file
1. Read the file
2. Look for inline corrections: strikethrough (`~~text~~`), comments (`<!-- comment -->`), tracked changes, or annotations
3. If no corrections are found, ask: "I didn't find inline corrections in this file. Can you describe what should change?"
4. Extract each correction as a separate candidate rule

---

## Step 1: Read Current Style Guide

Load the current merged style guide state:

1. Read `.content-style-guide.md` at the project root
2. Read the project default at `.builder/skills/style-guide/references/default-voice-and-tone.md`
3. Note which sections in the local file have real content vs. placeholder text (`[Add rules here via /content-style-update]`)

This establishes the baseline. New rules must not conflict with existing ones.

## Step 2: Formulate Rules

For each correction in the input, formulate a structured rule:

**Determine the target section:**

| Correction type | Target section |
|----------------|---------------|
| Voice/tone correction ("don't sound preachy", "more conversational") | Voice Characteristics |
| Writing constraint ("no em dashes", "short paragraphs") | Hard Rules |
| Format rule ("code blocks need language identifiers") | Formatting |
| Banned phrase ("never say 'deep dive'") | Phrases to Avoid |
| Content structure ("always end with a challenge") | Content Rules |

**For Hard Rules, use this format:**

```
| # | Rule | Detection Pattern | Fix |
|---|------|-------------------|-----|
| N | [Brief imperative rule] | [What to look for] | [How to fix it] |
```

**For other sections, use bullet format:**

```
- **[Bold lead]:** [Explanation]
```

**For Phrases to Avoid, use simple bullet format:**

```
- "[Exact phrase to avoid]" -- [replacement or guidance]
```

## Step 3: Conflict Detection

For each formulated rule, check for semantic conflicts with existing rules:

1. Read all existing rules in both the local override and project default
2. Check if the new rule contradicts an existing rule (e.g., "allow 4 em dashes" vs. existing "max 2 em dashes")
3. Check if the new rule duplicates an existing rule (same intent, different wording)

**If conflict detected:**

Present both rules using **AskUserQuestion**:

**Question:** "This new rule conflicts with an existing rule. Which should apply?"

Show:
- **Existing rule:** [rule text] (source: [default/local])
- **New rule:** [proposed rule text]

**Options:**
1. **Replace** -- New rule replaces the existing one
2. **Keep existing** -- Discard the new rule
3. **Merge** -- Combine both rules (describe how)

**If duplicate detected:**

Inform: "A similar rule already exists: [existing rule]. Skipping."

## Step 4: Approval Gate

Present all formulated rules to the user for approval before writing anything.

Use **AskUserQuestion**:

**Question:** "Here are the rules I'll add to `.content-style-guide.md`. Approve?"

Show each rule with:
- Target section (Hard Rules, Phrases to Avoid, etc.)
- The formatted rule text
- Whether it's new or replacing an existing rule

**Options:**
1. **Approve all** -- Add all rules
2. **Approve some** -- Select which rules to add (follow up with selection)
3. **Edit** -- Modify rule wording before adding
4. **Cancel** -- Discard all

Do not proceed without explicit approval. Bad rules degrade all future posts.

## Step 5: Write to Style Guide

Apply approved rules to `.content-style-guide.md`:

**If the target section has placeholder text** (`[Add rules here via /content-style-update]`):
- Replace the placeholder with the new rule(s)
- For Hard Rules: add the table header row first, then the rule rows

**If the target section has existing content:**
- For Hard Rules: append new row(s) to the existing table, incrementing the row number
- For bullet sections: append new bullet(s) after existing bullets
- For Phrases to Avoid: append new phrases after existing phrases

**If the target section doesn't exist:**
- Add the section heading and content before the last section in the file

**Never modify the project default** (`.builder/skills/style-guide/references/default-voice-and-tone.md`). All updates go to the local override only.

---

## Completion

After writing, present a summary:

```
Style guide updated!

Rules added to .content-style-guide.md:

[Section]: [Rule summary]
  → [Full rule text]

[Section]: [Rule summary]
  → [Full rule text]

Total rules in local override: [count]
Sections with local rules: [list]
```

### Next Steps

Use **AskUserQuestion**:

**Question:** "Style guide updated. What's next?"

**Options:**
1. **Add more rules** -- Continue adding corrections
2. **View style guide** -- Read the full `.content-style-guide.md`
3. **Done** -- Finish

If the user selects "Add more rules," loop back to the input step.

---

## Examples

### Example 1: Simple phrase ban

**Input:** "Never use 'deep dive' -- it's the most AI-sounding phrase in tech writing"

**Formulated rule:**
- Section: Phrases to Avoid
- Rule: `- "deep dive" -- replace with specific action ("explore", "examine", "break down")`

### Example 2: Hard rule from correction

**Input:** "Stop starting paragraphs with 'It's worth noting that' -- just say the thing"

**Formulated rule:**
- Section: Hard Rules
- Rule: `| N | No throat-clearing openers | "It's worth noting that...", "It's important to mention..." | Delete the opener; start with the actual point |`

### Example 3: Conflict with existing rule

**Input:** "Allow up to 4 em dashes per post"

**Existing rule (Hard Rule #5 in default):** "No em dash excess -- >2 em dashes per post"

**Action:** Present conflict. User decides: replace, keep existing, or merge.

### Example 4: Multiple corrections from a post

**Input:** Path to a post with comments like `<!-- too wordy -->`, `<!-- AI-sounding -->`, `<!-- needs a code example here -->`

**Formulated rules:**
1. Hard Rules: "Flag sections over 100 words without a code example or visual"
2. Phrases to Avoid: [specific phrases marked as AI-sounding]

## Important Notes

- Always write to `.content-style-guide.md` (local override), never to the project default. Prefer adding project-specific overrides to `.content-style-guide.md` rather than modifying the baseline.
- Placeholder text (`[Add rules here via /content-style-update]`) in a section means the section is empty. The Style Guide skill treats these as empty during merging.
- Hard Rules use the numbered table format: `| # | Rule | Detection Pattern | Fix |`. Other sections use bullet format.
- The approval gate is critical. One bad rule applied to every future post is worse than no rule at all.
- When multiple corrections come from a single post, batch them into one approval gate rather than asking one by one.
