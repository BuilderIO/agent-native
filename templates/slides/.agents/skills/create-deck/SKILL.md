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

## Workflow

1. Read the `creative-context` skill and retrieve factual evidence separately
   from presentation structure. Respect `contextMode: "off"`.
2. Unless the user named a reference deck or design system, call
   `get-workspace-defaults` and use what it returns. See "Workspace Defaults".
3. Plan the slides (deck title, title slide, section dividers, content slides).
4. Call `create-deck --title "..." --slides '[]'` with a concise, specific
   title derived from the user's request and source material. The action opens
   the new empty deck through application state. Never use `Untitled Deck` or
   another placeholder title for a generated deck.
5. If the connected browser does not consume the navigation command, call
   `navigate` with the new deck id.
6. Call `add-slide` once per slide in slide order, waiting for each result.

When speaker notes are requested, put presenter-only text in each slide's
`notes` field on `create-deck` or `add-slide`; keep it out of the slide HTML.
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
and slide chrome. Impeccable-inspired advice about hierarchy, subtraction,
contrast, and polish is a review lens, not a competing theme. If the request is
open-ended and no approved direction exists, ask one targeted guided question
or present a bounded choice before writing; do not silently pick a new brand
language.

When the source is a transcript or meeting notes, extract the audience's
terminology, goals, objections, decisions, owners, dates, metrics, and open
questions before outlining. Preserve exact names, numbers, dates, and requested
quotes; retain speaker/source attribution; distinguish quotation, paraphrase,
inference, and unresolved claim. Do not invent connective claims to make the
story smoother. Keep factual evidence separate from visual references and
record the source/version identifiers in provenance when available.

When creative context is available, pass the pre-generation search result's
`contextPackId` to `create-deck`, pass deck-wide `reuseLabels`, and add
`creativeContextReuseLabels` to each slide that reused a specific item/version.
Do not omit these fields and let the final write action search after the HTML
has already been authored; that would fabricate influence. With an empty
library, omit them. With Library mode Off, omit them and create normally.
   before adding the next slide

Do not create multiple slides in parallel for the same deck. Do not spawn
sub-agents to write into the same deck at the same time. Sub-agents may research
or draft slide copy, but one writer should call `add-slide` sequentially so the
editor stays stable and the user can watch progress.

## Reference Decks

The user can pick an existing deck as a style reference when starting a new one.
When they do, a `## Reference Deck` block is already in your context holding one
worked HTML example per layout.

Treat it as a pattern library, not an outline. The most common failure here is
walking the reference deck slide by slide and swapping in new copy, which
produces a deck with the wrong shape for its own content. Instead:

1. Plan the new deck from the user's request alone — story, slide count, order.
2. For each slide you decided to write, pick the pattern that fits that content.
3. Reuse a pattern as often as the content warrants, or never.
4. When nothing fits, compose a new slide from the same type scale, spacing,
   color, and markup conventions rather than bending content to a near-miss.

The block deliberately omits the reference deck's slide sequence. Call
`get-deck --id <reference deck id> --compact false` only if you need full slide
HTML to see how that deck handled a case the patterns do not cover.

A reference deck and a design system are independent: the design system wins on
tokens (color, type, spacing, imagery, and slide defaults), the reference deck
wins on slide-level composition and markup idiom. Apply both when both are
present. Generic templates in this skill are fallback patterns only. Never let
a reference screenshot or deck silently transfer its brand tokens.

Decks the user has starred are their intended reference decks. `list-decks`
reports `starred` so you can offer them when the user asks for something "like
our usual deck".

## Workspace Defaults

A workspace admin can flag one deck and one design system as the workspace
default, so a bare "make a deck about X" still comes out on brand. When the user
did not name a reference deck or design system, call `get-workspace-defaults`
before planning slides.

- `referenceDeck` — call `get-deck-reference-context --id <id>` and treat the
  result exactly like a user-picked reference deck.
- `designSystem` — pass its id as `designSystemId` to `create-deck`, unless the
  caller already has a personal default, which `create-deck` applies on its own.
- Either field can come back `{ unavailable: true }`. That means the default
  exists but this user cannot open it, which is a misconfiguration, not an
  absent default. Generate without it and tell the user their workspace default
  is not shared with them, rather than silently producing an off-brand deck.

An explicit request always wins over the workspace default. Do not re-apply a
workspace default to an existing deck the user is editing.

If the user provides a Google Docs URL as source material, call
`import-google-doc --url <url>` first and build from the returned text. If the
action cannot read a private document, the user can connect Google Docs and
choose the file through the picker, or share the Doc with the configured service
account. Relay the action's exact access instructions instead of generating from
the URL alone.

```bash
pnpm action create-deck --title "My Deck" --slides '[]'
```

`create-deck` also writes the navigation command. If the connected browser did
not consume it, navigate explicitly:

```bash
pnpm action navigate --deckId=<id from create-deck output>
```

Then add slides one by one:

```bash
pnpm action add-slide --deckId=<id> --layout title --content "..."
pnpm action add-slide --deckId=<id> --layout content --content "..."
```

## Slide Wrapper

Every slide's `content` must use this exact outer div:

```html
<div class="fmd-slide" style="padding: 64px 80px; display: flex; flex-direction: column; justify-content: flex-start; font-family: var(--ds-body-font, Inter, sans-serif);">
  <!-- slide content here -->
</div>
```

The literal values in the examples below are fallback values for a deck with no
linked system. When a system is linked, use its hydrated values or the renderer
variables (`--ds-accent`, `--ds-bg`, `--ds-text`, `--ds-text-muted`,
`--ds-heading-font`, `--ds-body-font`, `--ds-radius`) instead of copying
Poppins, cyan, white, black, or a stock radius into new markup.

## Fit budget

The canvas is fixed at its aspect-ratio dimensions. With the standard 16:9
canvas (960x540) and `padding: 64px 80px`, the usable content area is only
800x412px. Treat that as a hard budget for the main flow: use at most two title
lines, three short bullets or cards, and two or three short items per column.
Split dense source material across slides instead of shrinking it into a dense
stack. Keep body text at or above 16px. Never hide overflow with zoom,
`transform: scale()`, clipping, or scroll overflow. A later structural repair
may reduce the slide's explicit padding, and that padding must remain intact
when the saved HTML is rendered.

When no reference deck or hydrated design system is available, use the fallback
direction: warm neutral paper (`#F5F2EA`), ink text (`#1F2933`), Inter or a
close sans-serif, 64px vertical and 80px horizontal padding, and one restrained
blue or coral accent. Build an intentional composition beyond a text dump: use
a title block, two-column split, metric treatment, rule, callout, visual
placeholder, or simple diagram where it fits the message. Never use a black
background with white text as the generic fallback, never omit the padded
wrapper, and never let body copy touch the canvas edge. Do not add decorative
cards or shapes without a semantic role, and keep any accent treatment away
from text so contrast stays readable.

## Bounded visual QA

Before calling the deck complete, render every changed slide at its canonical
aspect-ratio dimensions and make one batched review pass. Check hierarchy and
source fidelity, overflow or clipping, contrast, minimum readable text,
placeholder remnants, broken or missing images, asset fit, and preserved
`data-slide-object-id` values. Fix the findings in one correction pass and
recheck. Do not claim full-deck or pixel-perfect fidelity unless the whole deck
was rendered and compared.

## Ready-to-Use Templates

Copy and fill in the bracketed values. Keep the wrapper styles and replace
tokens with the hydrated design-system values when available.

### Title Slide

```html
<div class="fmd-slide" style="padding: 64px 80px; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; gap: 18px; font-family: var(--ds-body-font, Inter, sans-serif);">
  <div style="font-size: 14px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ds-accent, #2457D6);">[LABEL OR DATE]</div>
  <h1 style="font-size: 56px; font-weight: 750; color: var(--ds-text, #1F2933); line-height: 1.05; letter-spacing: -0.04em; margin: 0; max-width: 760px;">[TITLE]</h1>
  <p style="font-size: 20px; color: var(--ds-text-muted, #667085); margin: 4px 0 0;">[SUBTITLE OR PRESENTER]</p>
</div>
```

### Content or Two-Column Slide

```html
<div class="fmd-slide" style="padding: 64px 80px; display: flex; flex-direction: column; justify-content: flex-start; gap: 18px; font-family: var(--ds-body-font, Inter, sans-serif);">
  <div style="font-size: 13px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ds-accent, #2457D6);">[SECTION LABEL]</div>
  <h2 style="font-size: 34px; font-weight: 750; color: var(--ds-text, #1F2933); line-height: 1.12; letter-spacing: -0.03em; margin: 0 0 18px;">[SLIDE HEADING]</h2>
  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: start;">
    <div style="display: flex; flex-direction: column; gap: 14px;">
      <div style="border-left: 3px solid var(--ds-accent, #2457D6); padding: 12px 16px; background: var(--ds-surface, #FFFFFF); border-radius: var(--ds-radius, 14px); font-size: 18px; line-height: 1.4;">[KEY POINT]</div>
      <div style="border-left: 3px solid var(--ds-secondary, #C85C3A); padding: 12px 16px; background: var(--ds-surface, #FFFFFF); border-radius: var(--ds-radius, 14px); font-size: 18px; line-height: 1.4;">[KEY POINT]</div>
    </div>
    <div class="fmd-img-placeholder" style="min-height: 220px; border-radius: var(--ds-radius, 14px);">[VISUAL OR IMAGE DESCRIPTION]</div>
  </div>
</div>
```

Use the same wrapper and tokens for section, statement, metrics, and closing
slides, changing only the composition. An image placeholder, metric row,
short rule, or callout should support the message, not fill empty space.

## Image Placeholders

When a slide needs a visual, use this div. It renders as a styled placeholder
and can later be replaced with a generated image:

```html
<div class="fmd-img-placeholder" style="width: 100%; min-height: 220px; border-radius: var(--ds-radius, 14px);">[Description of what image should show]</div>
```

## Bulk Replacement Only

Use a non-empty `create-deck --slides '[...]'` payload only for imports or an
intentional atomic bulk replacement. For normal AI-generated decks, use the
empty-deck plus sequential `add-slide` workflow above.

For a bulk replacement, pass the same fully styled HTML templates in the
`slides` array. After creating, navigate to the deck:
```bash
pnpm action navigate --deckId=<id>
```
