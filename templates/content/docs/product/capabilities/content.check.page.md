---
record_type: "capability"
spec_version: 2
id: "content.check.page"
name: "Checks"
user_promise: 'Put a sentence on a page, like "Under 120 words", and see every part of the page that doesn''t pass, without anything changing your text.'
primary_user_job: "Keep a draft inside the limits its writers agreed on while it keeps changing."
kind: "workflow"
state: "in_progress"
publicness: "public"
availability: "universal"
dependencies: ["content.object.page", "content.author.document-editor"]
related_features: ["content.feature.writing-that-keeps-itself-right"]
roadmap_boundary: "feature"
acceptance_summary: "Editors add, change, pause, run and skip checks on a page; commenters see each check's answer as a dot beside the text and in the page's Checks list; viewers and public readers receive nothing; and every answer is fine, not fine, skipped, changed since the last check, or couldn't check with its reason."
proof_requirements:
  [
    "A count check (words, sentences, paragraphs) on the page, the intro, a section or each paragraph answers from the saved text, and the add box shows the same answer before the check is saved.",
    "Text edited after the last check shows as changed since the last check, keeps its last answer while someone is still typing, and is rechecked a few seconds after typing stops once the page has saved; opening or reading a page runs nothing.",
    "Skip here hides one place until its text changes, and Undo brings it back.",
    "A failed or unavailable check is never shown as fine or as empty: it says couldn't check, with the reason.",
    "Editors add, change and run checks; commenters only read them; viewers and public readers are sent nothing, and a page holds at most 20 checks.",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-11-25"
---

# Checks

## Why this exists

Writers agree on limits ("under 120 words", "every section opens with an example") and then lose them a draft later. Required fields and validation keep Properties right, but nothing looks at prose, and refusing to save would be wrong: a draft is allowed to be wrong for a while. People need the page itself to keep pointing at what doesn't pass, quietly, until it does.

## Example workflow

Dana's intro is 183 words. She adds "Under 120 words" to the intro, and the add box says "183 words, 63 over" before she saves. She cuts the intro to 118 words; a few seconds after she stops typing, the dot beside it disappears and the header's count drops by one. Nobody else is notified.

## Product contract

- A check is one sentence of at most three parts and a place: the page, the intro, a section, or each paragraph. It is called a check, never a Rule; a Rule is a check plus _when_ and _then_.
- A check never changes the page's text and never posts a comment by itself. Comment opens the ordinary comment box with the reason filled in, and nothing posts until a person sends it.
- Each place has exactly one of five answers, which never look alike: fine, not fine, skipped, changed since the last check, and couldn't check with its reason.
- Results are stored per check wording and per place text, so unchanged text is never checked twice.
- Stale stays visible and failed is never empty, as in `content.expression.cached-result`: a place whose text changed keeps showing that it changed, and a failed check says couldn't check instead of fine or nothing.
- Check now and the typing pause are the only triggers. Opening, reading, or an agent editing a page nobody has open runs nothing.
- People and agents share the same Actions: list, add, change, delete, try, run and skip.

## Boundaries and non-goals

- Validation, which refuses a value, stays with `content.property.constraints`; a check only points.
- Event-driven Rules stay with `content.rule.deterministic`; a check runs from the open editor or on request, not from committed Events.
- Counting needs no AI. Yes/no questions answered by a model, How sure, per-page daily limits and naming the model are a later increment, as are each section and Only where.
- Checks on Collection rows are a later increment that will use the conditions a Collection's View uses.

## Acceptance stories

### See an over-long intro before saving the check

Given an intro of 183 words, when an editor types "Under 120 words" into the add box with the intro chosen, then the box shows "183 words, 63 over" before anything is saved, and saving puts a filled dot beside the intro.

### Recheck after typing stops

Given a check marking the intro, when the editor cuts it to 118 words and stops typing, then the dot keeps its last answer while they type and disappears a few seconds after they stop, once the page has saved.

### Keep commenters and readers on their side of the line

Given a page with checks, when a commenter opens it, then they see the dots and the Checks list but cannot add, change, run or skip a check; when a viewer or a public reader opens it, then the server sends them no checks at all.

### Never turn a failure into fine

Given a check that couldn't run, when anyone reads the page, then the place says couldn't check with its reason, not fine and not blank.

## Current evidence

The first increment adds the check, result and skip tables, the shared counting in `templates/content/shared/page-checks.ts`, the seven page-check Actions in `templates/content/actions/`, and the editor's dots, add box, Checks list in Info and header count in `templates/content/app/components/editor/page-checks/`. `actions/page-checks.db.test.ts` and `shared/page-checks.spec.ts` cover the counting, the answers, access and the limit.

## Proof plan

1. Run the Action tests for counting, answers, skips, access by role and the 20-check limit.
2. In the editor, reproduce the 183-to-118-word example at desktop, tablet and phone widths, in light and dark, and in a right-to-left locale.
3. Edit a checked place and confirm it shows changed, keeps its last answer while typing, and is rechecked after the pause.
4. Open the page as a commenter, a viewer and a public reader and confirm what each receives.

## Open questions

- How yes/no checks name the model that reads the text, and what happens when that model is gone.
- Whether a check should ever run without an editor open, once committed Events exist.
