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

## Assets reuse

Search visual references separately from factual evidence. When a retrieved
image should directly guide generation, import its stable media URL with
`import-asset-from-url` as a reference asset in the selected brand kit, then
pass that asset id through the normal `referenceAssetIds` path. Do not pass a
context-item URL directly to an image provider. Keep the returned
`contextPackId` and reuse labels in generation-run and output-asset metadata
alongside the normal reference selection provenance.
