# Reference decks, attached documents, and workspace defaults

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

## Attached Reference Documents

A PDF, PPTX, or DOCX attached to a new-deck prompt is read before your run
starts. Its extracted content and, for a PDF, its measured visual language —
page proportions, painted backgrounds, the ranked type scale with families,
sizes, weights and colors, median text margins, paragraph alignment — arrive as
an `## Attached Reference Documents` block.

That block is the reference. Do not call `import-file` for a file listed there,
and never generate as if the attachment were missing: if the file could not be
read, the run would have been stopped before it reached you, so a file you can
see in that block was read successfully.

When the user attached the file as a visual or style reference, match the
measured type scale, weights, colors, alignment, and margins. A deck generated
from a style reference must not come out looking like one generated without it.
Structure and wording still come from the user's request, not from the
reference's own page order.

The fallback visual language in this skill applies only when no reference
document, reference deck, or design system is present.

## Workspace Defaults

A workspace admin can flag one deck and one design system as the workspace
default. Use `get-workspace-defaults` once when needed to identify a workspace
reference deck or design system; `create-deck` also applies the effective design
system default when no override is passed.

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
