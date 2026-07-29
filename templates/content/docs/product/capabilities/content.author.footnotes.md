---
record_type: "capability"
spec_version: 2
id: "content.author.footnotes"
name: "Footnotes"
user_promise: "Add a durable explanatory or citation note without manually managing superscript text."
primary_user_job: "Add and navigate durable semantic notes beside prose."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.object.block", "content.object.reference"]
related_features: ["content.feature.cite-what-you-found"]
roadmap_boundary: "feature"
acceptance_summary: "Footnotes have stable anchors, visual editing, automatic numbering, bidirectional navigation, accessibility, and provider-neutral source/export parity."
proof_requirements:
  [
    "A footnote reference and body are semantic authoring objects, not ordinary superscript text.",
    "Numbering and back-links derive from the document order while anchors retain identity through edits.",
    "Editor, reader, and export use the shared source representation and expose an accessible fallback.",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Footnotes

## Why this exists

Writers need to qualify a claim without breaking the reading flow or hand-numbering fragile markers. Notes need to stay attached through revision and remain usable to readers who navigate by keyboard or assistive technology.

## Example workflow

A historian inserts a footnote, reorders paragraphs, and exports; numbering updates while readers can move from reference to note and back.

## Product contract

- A footnote reference and body are semantic authoring objects, not ordinary superscript text.
- Numbering and back-links derive from the document order while anchors retain identity through edits.
- Editor, reader, and export use the shared source representation and expose an accessible fallback.

## Boundaries and non-goals

- Citation records own source metadata and bibliography policy; Footnotes own inline note anchors, authoring, navigation, and source representation.
- Footnotes are not superscript text, Custom Blocks, or a reason to add general raw-source editing.

## Acceptance stories

### Preserve anchor identity

Given prose is revised and notes reorder, when saving, then identity survives while numbering updates.

### Export a readable fallback

Given a destination lacks footnotes, when exporting, then the note is not flattened into unexplained superscript text.

## Current evidence

No footnote extension exists under `app/components/editor/extensions/`; `app/components/editor/VisualEditor.tsx` and `shared/nfm.ts` are donors.

## Proof plan

1. Insert/edit/delete/reorder notes and verify anchors and links.
2. Test keyboard and screen-reader traversal.
3. Round-trip through source and export adapters.
4. Test copy/paste and concurrent edits.

## Open questions

No product question remains.
