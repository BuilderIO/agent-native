---
record_type: "capability"
spec_version: 2
id: "content.research.citation"
name: "Citations"
user_promise: "A citation retains a durable source-and-locator identity even when its style or surrounding document changes."
primary_user_job: "Cite exact evidence once and render it as a link, footnote, number, author-date reference, or bibliography without re-entering the source."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.object.reference", "content.knowledge.links"]
related_features: ["content.feature.cite-what-you-found"]
roadmap_boundary: "feature"
acceptance_summary: "A semantic citation references a stable source record plus optional page, section, figure, timestamp, transcript, or range locator; rendering styles and bibliographies derive from that identity while access and round-trip behavior remain explicit."
proof_requirements:
  [
    "Citation identity, locator, promotion, style, bibliography, and round-trip tests",
    "Access, missing-source, locator-validation, import/export, and renderer-separation tests",
    "Writer workflow promoting a link, changing style, and verifying bibliography output",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Citations

## Why this exists

A footnote is a costume; the citation is the durable relationship underneath it.

## Example workflow

A writer promotes a research link, adds a page locator, switches from author-date to footnotes, and sees a bibliography recompute from the same cited source identity.

## Product contract

- Citation identity points to a durable source record and optional precise locator: page, chapter, section, figure, timestamp, transcript range, or text range.
- An ordinary link can be promoted without losing its original anchor. The citation remains separate from its renderer and bibliography placement.
- Styles may render linked blog, numeric, author-date, footnote, and bibliography forms, including CSL-compatible behavior where supported.
- Access is checked when source details render or export; missing or inaccessible data is represented honestly rather than fabricated.

## Boundaries and non-goals

Annotations record interpretation; references link Content objects; this record owns formal citation identity. It does not promise to maintain every bibliography style by hand.

## Acceptance stories

### Change style without changing evidence

Given a document with semantic citations, when the writer changes its style from author-date to footnotes, then the cited source identities and locators remain unchanged while rendered references and bibliography update.

### Preserve a locator through export

Given a citation to a video timestamp, when the document exports to a supported format, then the source identity and timestamp survive or the conversion report identifies the fidelity limit.

## Current evidence

Donor evidence: ordinary links, references, source metadata, rich text, and export machinery can support citation work. No first-class citation object, locator, bibliography, or end-to-end rendering proof exists; this record remains `approved_shape`.

## Proof plan

1. Define citation/source/locator identity and link-promotion behavior.
2. Test styles, bibliography, access, imports, exports, and unavailable sources.
3. Verify writer promotion and style-switch workflow in the editor and public/export renderers.

## Open questions

- The initial CSL engine and Zotero interchange scope remain open.
