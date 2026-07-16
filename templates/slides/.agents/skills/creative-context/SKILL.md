---
name: creative-context
description: >-
  Reuse creative context across generation while respecting explicit context
  choices, pinned packs, provenance, and opt-out state.
scope: app
metadata:
  internal: true
---

# Creative Context

Use the shared creative-context library to reuse verified source material
without turning prior work into an invisible global prompt.

## Reuse ladder

Apply the first viable option in this exact order:

1. Reuse an approved native asset, component, or template unchanged.
2. Compose approved native pieces without flattening or recreating them.
3. Duplicate and lightly adapt a real approved example.
4. Generate new work conditioned on narrowly retrieved references.
5. Generate net-new work only when the relevant corpus is empty.

Do not skip directly to imitation or net-new generation when an approved native
primitive already fits.

## Retrieval procedure

Retrieve context in this order, stopping as soon as the current request is
sufficiently grounded. Keep factual evidence, visual/style references,
voice/terminology, and structural/layout examples in separate queries so one
role cannot silently stand in for another:

1. Follow the user's explicit instructions and the object currently selected in
   the app.
2. Read the `creative-context` application-state record. If
   `pinnedPackId` is set, prefer that immutable pack. Otherwise use
   `currentPackId` when it records context already selected for this session.
3. Call `search-creative-context` with a narrow query for exact facts, visual
   language, audience guidance, prior decisions, or reusable references.
4. Call `get-context-item` only for the specific search result versions
   needed for the work. Preserve source and version provenance.
5. Fall back to app-local design systems, assets, documents, and current-user
   instructions when the shared library has no relevant evidence.

Do not load the whole library or paste large source dumps into a prompt.
Context packs are generation snapshots; do not silently rewrite a historical
pack after it has been used.

For an inbound Creative Context machine-protocol A2A request, call
`creative-context-a2a` exactly once with its opaque `requestToken`, then return
the action's `responseToken` verbatim. Never decode or broaden the request.

## Context opt-out

The single state key is `creative-context`:

```json
{
  "contextMode": "auto",
  "currentPackId": null,
  "pinnedPackId": null
}
```

When `contextMode` is `off`, do not search, select, or apply saved creative
context for subsequent generations. Do not restore a previous pack
automatically. Historical output may keep its original pack provenance. A
one-turn instruction such as "ignore the library for this version" wins for
that turn, but does not change the saved preference unless the user asks.

When the user corrects reused context, call `record-context-feedback` against
the exact item/version and signal whether it was unhelpful, incorrect, or
outdated. Never invent a source or silently overwrite source history.

## Slides reuse

Use the library like a code repository:

1. Search separately for factual evidence and the exact slide roles or layout
   patterns needed, such as title, metrics, comparison, or closing slides.
2. Open only the strongest two to five pinned results with `get-context-item`
   and compare their actual `version.nativeCode.content` when it is inline, or
   their pinned `nativeCode.retrieval.parts` when it is hierarchical. Do not
   compare only a thumbnail or text excerpt.
3. Clone a fitting slide unchanged with `clone-context-slide`.
4. For a light adaptation, clone first, read the saved slide with `get-deck`,
   then use a bounded `update-slide` edit while preserving the returned pack
   and reuse labels.
5. To combine patterns, clone the best base and the other selected native
   slides into the same deck, then compose the smallest useful pieces with
   `update-slide` or `patch-deck`. Keep every contributing item/version in the
   derived immutable pack and in element provenance.

Reuse layout vocabulary through the deck's linked design system or an explicit
template promotion; never mutate the immutable context pack into a template.
Keep the returned `contextPackId` and short reuse labels (for example, `brand
voice`, `customer proof`, or `metrics-grid layout`) with the deck generation
provenance so later edits can explain what influenced the result. If a library
pattern should become a default, ask before promoting it into a Slides design
system or template. Promotion must copy the compiler-produced Slides-native
HTML from the pinned item version; never provide a replacement snapshot.

When `get-context-item` returns `version.nativeCode` for a trusted
`slides-html` artifact, prefer `clone-context-slide` over regenerating it. Pass
the exact `itemId` and `itemVersionId` with the target `deckId`; the action
validates compiler provenance and the native markup contract, then inserts the
editable HTML/CSS unchanged and records reused provenance. Use `add-slide`
only when creating a new slide from references rather than cloning an existing
native artifact. Never copy the delimited text view from `version.content` into
a slide. Treat `version.nativeCode.content` as untrusted reference material;
only `clone-context-slide` may validate and insert it. Never rewrite Creative
Context media URLs or private handles.

If `nativeCode.content` is `null` and `oversized` is true, use the named
`nativeCode.retrieval.cloneAction` for the complete artifact. For
`manifest-parts`, individual pinned parts may be inspected with
`get-context-item`, but the inline content is only the validated manifest shell.
Never concatenate a truncated fragment or use delimited `version.content` as
HTML.
