# Slides 2

An Agent-Native app for creating, visually editing, and presenting slide decks.
The home page lists decks and templates and starts generation through agent
chat. The visual editor previews and edits the same source the agent writes.

## Storage and source contract

Decks use the existing `decks` SQL table. Each deck's `data.slides[]` stores
ordered slide rows with canonical `sourceTsx`, `revision`, and `sourceHash`
fields, plus notes and metadata. The `content` HTML field is a derived preview
for source-backed slides; imports that only contain HTML remain legacy slides.
Source edits use revision and hash compare-and-swap, then regenerate the
preview. Deck version snapshots provide restore points. Slide source contains
only `asset://` references; uploaded binary assets stay in configured blob
storage and SQL keeps their handles and metadata.

The server validates slide source and returns a bounded render artifact. The
artifact includes a React Worker bundle for the opaque-origin sandbox; the
editor and presenter render it there, never in the app page's origin. The
visual editor's PDF and image-based PPTX exports render the artifact in the
sandbox before capturing it; the image PPTX stores one raster image per slide.
The server's editable PPTX export attempts bounded static rendering for
source-backed slides without a saved preview. Sources that require Worker
rendering return `source_runtime_export_required` before a file is written.
Server HTML and Google Slides exports still need a saved static `content`
preview. Legacy and imported HTML slides keep using their script-free HTML
preview. Uploaded assets resolve through stored asset handles.
See the `create-deck` and `slide-editing` skills for the supported syntax and
edit workflow.

Public `/p/:id` and `/share/:token` pages use a share snapshot and do not have
deck viewer access to request the Worker artifact. New share snapshots flag
source-only pages and show a capability message; the shared-viewer PDF export
fails with the same typed error. Recreate older share links created before the
marker was added to identify source-only pages in their saved snapshots.

A static `export default [Cover, Body] satisfies Page[]` passed to `create-deck`
is split into ordered SQL slides, with up to 40 pages per module. This bounds
each module's expansion; persisted decks can contain and render more than 40
slides. An optional static
`export const notes = [...]` maps by page index; omitted entries become empty
notes. Each resulting SQL slide has its own source and revision. There is no
shared module file. Static `Cover.transition = {...}` assignments are copied
to the matching page as its transition override; the module `transition` export
remains the default for pages without an override. The `create-deck` skill lists
the renderer capabilities and source constraints.

## Develop locally

From the framework workspace, run:

```bash
pnpm --filter slides-2 dev
```

Third-party source and license attribution are recorded in
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).
