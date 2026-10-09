---
name: create-deck
description: >-
  Create a new deck with slides from scratch. Use before creating a deck or
  standalone visual; resolve source fidelity, creative context, and the active
  design system before using the fallback HTML patterns in this skill.
---

# Creating a Deck

**Do not explore the codebase for routine deck creation.** Use the app actions
and linked skills. This does not override the active design system, Creative
Context, reference deck, or source material that the app already provides.

## Read before

Read a reference with `docs-search --slug "skill-create-deck--references-<file>"`,
for example `skill-create-deck--references-reference-inputs`.

| Situation | Read |
| --- | --- |
| A reference deck, attached PDF/PPTX/DOCX, or workspace default applies | `references/reference-inputs.md` |
| The source is a transcript, meeting notes, or a Google Docs URL | `references/source-material.md` |
| Writing slide HTML from the fallback title/content patterns or image placeholders | `references/slide-templates.md` |

## Workflow

1. Read the `creative-context` skill and retrieve factual evidence separately
   from presentation structure. Respect `contextMode: "off"`.
2. Unless the user named a reference deck or design system, call
   `get-workspace-defaults` once and use the available reference and design
   system defaults. Call `get-design-system` once for the selected system and
   reuse its context. `create-deck` also resolves and attaches the effective
   default; use its returned context for later edits.
3. Plan the slides and write a compact deck brief: audience, thesis, one message
   per slide, visual direction, and the deck-level theme contract.
4. For a short, fully planned deck, call `create-deck` once with every slide
   in order. Include speaker notes and per-slide Creative Context reuse labels
   in the payload. Never create an empty deck and then add a finished short
   deck one slide at a time.
5. For long or live in-app generation, call `create-deck` with `slides: []`,
   then add slides sequentially as they are authored so each write preserves
   its per-slide Creative Context provenance. Wait for each result; after the
   first slide, read that slide once to verify the visual contract.
6. If the connected browser does not consume the navigation command, call
   `navigate` with the new deck id.

When speaker notes are requested, put presenter-only text in each slide's
   `notes` field on `create-deck` or `add-slide`; keep it out of the slide HTML.
Write notes as speech, not a summary of the slide: the opener, the transition
to the next slide, numbers to cite, a timing cue.
Preserve existing notes when editing or importing a source deck.

When the UI has already created the empty deck, keep its id and rename it before
adding the first slide. Call `patch-deck` with a `patch-deck-fields` operation
whose `fields.title` is the generated title. Do not leave the pre-created deck's
placeholder title in place. Include only `title` in that operation's `fields`;
omit all other optional fields.

Follow the creative-context reuse ladder before inventing a slide language:
reuse an approved native template unchanged, compose approved pieces, lightly
adapt a real approved example, generate from narrowly retrieved references,
then go net-new only when the relevant corpus is empty. Retrieval is a separate
step from generation. Persist the immutable `contextPackId` and concise reuse
labels with the deck's generation provenance; never infer provenance later from
rendered slide HTML.

## Direction and source checkpoint

Before authoring slide HTML, make a compact deck brief with the audience, job,
narrative thesis, one-sentence visual direction, active design-system tokens,
reference-deck composition pattern, image treatment, and known fit risks. The
linked Agent-Native design system controls tokens, typography, spacing, imagery,
and slide chrome. Read `slide-design` for visual craft; it works inside the
active system and reference deck, never as a competing theme. If the
request is open-ended and no approved direction exists, ask one targeted guided
question or present a bounded choice before writing; do not silently pick a new
brand language. Write a direction choice for this topic: three options, each a
vibe word plus one concrete visual cue (palette, type, motif; for example "rust
technical editorial: warm rust on charcoal, mono headings, code-grid layout"),
clearly different from each other, the best fit marked recommended. Never offer
generic labels such as "minimal" or "corporate" alone. Take everything else
(density, slide count, structure) from the request and do the work.

Before the first slide, lock a deck-level visual contract: background family,
text and surface roles, accent treatment, heading/body type pairing, spacing
scale, radius, and image treatment. With a linked system, derive the contract
from its hydrated tokens. Without one, choose a subject-appropriate direction
and repeat the same semantic `--deck-*` values on every slide wrapper. Vary
composition and information hierarchy, not the canvas, font system, or palette.
Alternating light and dark slides are a theme failure unless the user explicitly
asks for that structure.

When creative context is available, pass the pre-generation search result's
`contextPackId` to `create-deck`, pass deck-wide `reuseLabels`, and add
`creativeContextReuseLabels` to each slide that reused a specific item/version.
Do not omit these fields and let the final write action search after the HTML
has already been authored; that would fabricate influence. With an empty
library, omit them. With Library mode Off, omit them and create normally.

Do not create multiple independent writes in parallel for the same deck. Do not
spawn sub-agents to write into the same deck at the same time. Every newly
generated slide in a short, completed deck belongs in the initial `create-deck`
slides array. Use sequential `add-slide` writes only while a long deck is being
authored live. Reserve `patch-deck` for deck fields, existing-slide edits,
ordering, or source-preserving work. Sub-agents may research or draft slide
copy, but one writer owns every deck mutation so the editor stays stable and the
user can watch progress.

```bash
pnpm action create-deck --title "My Deck" --slides '[]'
```

`create-deck` also writes the navigation command. If the connected browser did
not consume it, navigate explicitly:

```bash
pnpm action navigate --deckId=<id from create-deck output>
```

For long or live generation, then add slides one by one:

```bash
pnpm action add-slide --deckId=<id> --layout title --content "..."
pnpm action add-slide --deckId=<id> --layout content --content "..."
```

## Slide Wrapper

Every slide's `content` must use the semantic `--deck-*` contract on its outer
div. Which of the two forms you use depends on whether a design system is
linked.

**A design system is linked.** Inherit the renderer's hydrated variables
(`--ds-bg`, `--ds-text`, `--ds-text-muted`, `--ds-accent`, `--ds-surface`,
`--ds-heading-font`, `--ds-body-font`, `--ds-radius`) through the contract
rather than copying values into individual elements:

```html
<div class="fmd-slide" style="--deck-bg: var(--ds-bg); --deck-ink: var(--ds-text); --deck-muted: var(--ds-text-muted); --deck-accent: var(--ds-accent); --deck-surface: var(--ds-surface); --deck-heading-font: var(--ds-heading-font); --deck-body-font: var(--ds-body-font); --deck-radius: var(--ds-radius); background: var(--deck-bg); color: var(--deck-ink); padding: 64px 80px; display: flex; flex-direction: column; justify-content: flex-start; font-family: var(--deck-body-font);">
  <!-- slide content here -->
</div>
```

**No design system is linked.** There is no house style to fall back to, and
the renderer publishes no `--ds-*` tokens beyond the slide's own background.
Derive a contract from the deck's subject and write it as literal values:

```html
<div class="fmd-slide" style="--deck-bg: #10261C; --deck-ink: #F2EFE6; --deck-muted: #A8B8AC; --deck-accent: #7FB069; --deck-surface: rgba(255,255,255,0.05); --deck-heading-font: 'Fraunces', Georgia, serif; --deck-body-font: 'Inter', sans-serif; --deck-radius: 4px; background: var(--deck-bg); color: var(--deck-ink); padding: 64px 80px; display: flex; flex-direction: column; justify-content: flex-start; font-family: var(--deck-body-font);">
  <!-- slide content here -->
</div>
```

That example is a nature-related deck, so colors match the topic of deck. Pick the values once, before the first slide, and repeat the identical contract on every wrapper.

Inheriting when nothing is linked is the failure mode to avoid: a
`var(--ds-accent, currentColor)` reference on an unlinked deck silently
resolves to a browser default, so the deck reads as unstyled rather than as the
direction you chose. Never import a stock presentation palette, font, or
component language as a substitute for choosing.

## Slide numbers

For a footer page number, use the tokens `<span data-slide-number></span>` and
`<span data-slide-total></span>`, never typed digits: reorders, inserts, and
deletes would leave a typed `04 / 08` stale. Add `="pad"` for two digits
(`<span data-slide-number="pad"></span> / <span data-slide-total="pad"></span>`
renders `04 / 08`). Leave the spans empty; the renderer fills them from the
slide's position in the deck.

## Fit budget

The canvas is fixed at its aspect-ratio dimensions. With the standard 16:9
canvas (960x540) and `padding: 64px 80px`, the usable content area is only
800x412px (usable height is canvas height minus both vertical paddings). Treat
that as a hard budget for the main flow: use at most two title lines, three
short bullets or cards, and two or three short items per column. A content slide
carries about 40 words besides its title. A bullet fits on one line (about 70
characters at 18px); only a card may wrap, to two lines. Split dense source
material across slides instead of shrinking it into a dense stack. Keep body
text at or above 16px. Never hide overflow with zoom, `transform: scale()`,
clipping, or scroll overflow. A later structural repair may reduce the slide's
explicit padding, and that padding must remain intact when the saved HTML is
rendered.

Before writing a slide, total its flow height: per text block, font-size x
line-height x wrapped lines (average glyph width is about 0.5 x font-size), plus
padding and gaps. Count every wrapped line and keep about 10% slack for the
measured check. Example: a two-line 34px/1.12 heading (76) + 18 gap + three
cards of two 18px/1.4 lines plus 24 padding (3 x 74 = 223) + two 14px gaps (28)
= 345, inside 412; a fourth card adds 88 and does not fit. When the total
exceeds the budget, split the slide; do not shrink type, padding, or gaps.

Build an intentional composition beyond a text dump: use a title block,
two-column split, metric treatment, rule, callout, visual placeholder, or
simple diagram where it fits the message. Keep the canvas stable across the
deck, use accents only for hierarchy or meaning, and do not add decorative
cards, gradients, fake logos, or shapes without a semantic role. A slide
with nothing real to show is complete with type, spacing, and a rule. A
built-in template's signature art belongs to that template; do not carry it
into other decks.

Author in normal flex/grid flow; the card, wrapper, height, and `contain` rules
are in `slide-editing` (Flow Layout and the Editor).

## Bounded visual QA

Before calling the deck complete, render every changed slide at its canonical
aspect-ratio dimensions and make one batched review pass. Check hierarchy and
source fidelity, overflow or clipping, contrast, minimum readable text,
placeholder remnants, broken or missing images, asset fit, and preserved
`data-slide-object-id` values. Fix the findings in one correction pass and
recheck. After all slide writes, call `get-layout-overflows` once; after a
measured-overflow repair, call it once more. If status is unknown, name the
unmeasured slide numbers and IDs, do not claim the deck fits, and do not repeat
the call this turn unless the editor has produced a new measurement. Then, as
the last step before the final response, call
`audit-contrast` for the deck and follow the Contrast section of
`slide-editing`; never judge contrast by eye or from hex values. Do not claim
full-deck or pixel-perfect fidelity unless the whole deck
was rendered and compared.

## Batch and incremental generation

Use a non-empty `create-deck --slides '[...]'` payload for a short, fully
planned generated deck, imports, or an intentional atomic bulk replacement.
For long or live in-app generation, use the empty-deck workflow above and add
each completed slide sequentially.

For a bulk replacement, pass the same fully styled HTML templates in the
`slides` array. After creating, navigate to the deck:
```bash
pnpm action navigate --deckId=<id>
```
