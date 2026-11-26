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
acceptance_summary: "Editors add, change, pause, run and skip count and yes/no checks on a page; commenters see each check's answer as a dot beside the text and in the page's Checks list; viewers and public readers receive nothing; every answer is fine, not fine, skipped, changed since the last check, or couldn't check with its reason; and a yes/no check names the model that reads the text before it runs."
proof_requirements:
  [
    "A count check (words, sentences, paragraphs) on the page, the intro, a section, each section or each paragraph answers from the saved text, and the add box shows the same answer before the check is saved.",
    "Only where narrows each section or each paragraph by heading text (contains, starts with or is, ignoring case) or heading level, a paragraph going by the heading it sits under; the add box says how many places match, and when none do it says nothing matches, never fine.",
    "On a page without block IDs, a renamed heading counts as a deleted section and a new one; a heading with a block ID keeps its answers through a rename.",
    "Text edited after the last check shows as changed since the last check, keeps its last answer while someone is still typing, and is rechecked a few seconds after typing stops once the page has saved; opening or reading a page runs nothing.",
    "Skip here hides one place until its text changes, and Undo brings it back.",
    "A failed or unavailable check is never shown as fine or as empty: it says couldn't check, with the reason.",
    "Editors add, change and run checks; commenters only read them; viewers and public readers are sent nothing, and a page holds at most 20 checks.",
    "A yes/no part's question is written once from the check's own words, shown under Edit question and editable there, and a part too vague to ask offers two sharper checks instead.",
    "How sure shows how many places each setting would mark, and switching it asks no model.",
    "Before a page's first yes/no check, the add box names the decision model and its company; the page keeps that model, and when it's gone its yes/no parts say couldn't check instead of switching.",
    "After 5,000 yes/no questions on a page in a day, the rest say couldn't check, today's limit, while counts keep working.",
    "On held-out labeled paragraphs, each eval check catches at least 8 of 10 that break it and marks at most 1 of 15 that don't, and still marks a paragraph that tells the model how to answer.",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-11-26"
---

# Checks

## Why this exists

Writers agree on limits ("under 120 words", "every section opens with an example") and then lose them a draft later. Required fields and validation keep Properties right, but nothing looks at prose, and refusing to save would be wrong: a draft is allowed to be wrong for a while. People need the page itself to keep pointing at what doesn't pass, quietly, until it does.

## Example workflow

Dana's intro is 183 words. She adds "Under 120 words" to the intro, and the add box says "183 words, 63 over" before she saves. She cuts the intro to 118 words; a few seconds after she stops typing, the dot beside it disappears and the header's count drops by one. Nobody else is notified.

Then she adds "Opens with something that happened to a developer" to the intro. Before she saves, the add box says the check is answered by Jev, from TypeSafe AI, shows the yes/no question it will ask, and says whether the intro passes.

## Product contract

- A check is one sentence of at most three parts and a place: the page, the intro, a section, each section, or each paragraph. It is called a check, never a Rule; a Rule is a check plus _when_ and _then_.
- Each section is every heading with everything under it, down to the next heading at its level or higher. Only where narrows each section or each paragraph by heading text or heading level, with the words Collection filters use ("contains", "starts with", "is"). A paragraph goes by the heading it sits under, and paragraphs above the first heading match no condition.
- A check never changes the page's text and never posts a comment by itself. Comment opens the ordinary comment box with the reason filled in, and nothing posts until a person sends it.
- Each place has exactly one of five answers, which never look alike: fine, not fine, skipped, changed since the last check, and couldn't check with its reason.
- Results are stored per check wording and per place text, so unchanged text is never checked twice.
- Stale stays visible and failed is never empty, as in `content.expression.cached-result`: a place whose text changed keeps showing that it changed, and a failed check says couldn't check instead of fine or nothing.
- Check now and the typing pause are the only triggers. Opening, reading, or an agent editing a page nobody has open runs nothing.
- A part that isn't a count is a yes/no part. The workspace's AI model writes its question once, from the check's words and never the page's text. A person can rewrite the question under Edit question, and a rewritten question is kept when the sentence changes. A part too vague to ask offers two sharper checks to pick from instead.
- A decision model answers each yes/no question for each place, given the page's text as data it must not take orders from. The add box names the model and its company before a page's first yes/no check, and the page keeps that model. When it's no longer available, the page's yes/no parts say couldn't check; a check never switches models.
- How sure (Only when sure, Balanced, Catch more) sets how likely a place must be to break a part before it's marked, and starts at Balanced. Each setting shows how many places it would mark from the answers already stored, so switching asks no model.
- A page answers at most 5,000 yes/no questions a day. The rest say couldn't check, today's limit, and count parts keep answering.
- People and agents share the same Actions: list, add, change, delete, try, run and skip.

## Boundaries and non-goals

- Validation, which refuses a value, stays with `content.property.constraints`; a check only points.
- Event-driven Rules stay with `content.rule.deterministic`; a check runs from the open editor or on request, not from committed Events.
- Counting needs no AI: a check made only of counts runs without any model.
- Checks on Collection rows are a later increment that will use the conditions a Collection's View uses.

## Acceptance stories

### See an over-long intro before saving the check

Given an intro of 183 words, when an editor types "Under 120 words" into the add box with the intro chosen, then the box shows "183 words, 63 over" before anything is saved, and saving puts a filled dot beside the intro.

### Recheck after typing stops

Given a check marking the intro, when the editor cuts it to 118 words and stops typing, then the dot keeps its last answer while they type and disappears a few seconds after they stop, once the page has saved.

### Keep commenters and readers on their side of the line

Given a page with checks, when a commenter opens it, then they see the dots and the Checks list but cannot add, change, run or skip a check; when a viewer or a public reader opens it, then the server sends them no checks at all.

### Check only the sections a heading names

Given a page whose sections are "Step one", "Step two" and "Notes", when an editor adds "At most 300 words" to each section, only where the heading starts with "step", then the add box says "2 of 3 match" and the check marks only the step sections; changing the condition to one no heading meets says "Nothing matches", not fine.

### Never turn a failure into fine

Given a check that couldn't run, when anyone reads the page, then the place says couldn't check with its reason, not fine and not blank.

## Current evidence

The first increment adds the check, result and skip tables, the shared counting in `templates/content/shared/page-checks.ts`, the seven page-check Actions in `templates/content/actions/`, and the editor's dots, add box, Checks list in Info and header count in `templates/content/app/components/editor/page-checks/`. `actions/page-checks.db.test.ts` and `shared/page-checks.spec.ts` cover the counting, the answers, access and the limit.

The second increment adds yes/no parts: writing and reading questions in `templates/content/shared/page-check-questions.ts`; asking the decision model, the daily limit and naming the model in `templates/content/server/lib/page-check-questions.ts`; and How sure, the question editor and the model notice in the add box. `actions/page-check-questions.db.test.ts` covers writing a question once, editing it, vague parts, How sure without asking again, a missing model, the daily limit and text that gives orders. `scripts/page-checks-eval/` holds 150 made-up labeled paragraphs for three checks, half of them unseen until the question writer's prompt was settled, with recorded answers its test scores against the bar.

The third increment adds each section and Only where: finding and narrowing places in `templates/content/shared/page-checks.ts`, the `only` condition in the Actions' scope, and the Where choice, the Only where controls and the match count in the add box. `shared/page-checks.spec.ts` covers section ranges, repeated and renamed headings, every condition and keys that stay put when a condition narrows the list.

## Proof plan

1. Run the Action tests for counting, answers, skips, access by role and the 20-check limit, for each section and Only where, and for writing questions, How sure, a missing model and the daily limit.
2. Score the eval's recorded answers, and record a fresh run whenever the question writer's prompt or the decision model changes.
3. In the editor, reproduce the 183-to-118-word example at desktop, tablet and phone widths, in light and dark, and in a right-to-left locale.
4. Edit a checked place and confirm it shows changed, keeps its last answer while typing, and is rechecked after the pause.
5. Open the page as a commenter, a viewer and a public reader and confirm what each receives.

## Open questions

- Whether a page should be able to move its yes/no checks to another model on purpose, rechecking every place.
- Whether a check should ever run without an editor open, once committed Events exist.
