---
name: create-deck
description: >-
  Create source-backed slide decks from a prompt or reference. Use before
  creating a deck, writing React slide pages, or continuing live generation.
---

# Creating a Deck

All slide generation happens in agent chat. The agent authors React source and
calls deterministic actions to validate and save it; the UI never calls an LLM.
The Home prompt flow counts as started only after agent chat confirms delivery.
If delivery fails or the handoff throws, return a setup failure and keep the
prompt open instead of leaving an empty deck looking like a generated result.

## Workflow

1. Read `creative-context` and retrieve factual evidence separately from visual
   structure. Respect `contextMode: "off"`.
2. Unless Home already supplied a user-selected system or a reference controls
   the visual style, call `get-workspace-defaults` once. A normal
   `create-deck` call resolves and links its effective default. Home's
   `promptDraft` is already persisted with only the user's explicit selection;
   if its context asks for a usable workspace default, link that existing deck
   with `patch-deck` and `patch-deck-fields` before adding slides. Do not create
   a second deck. Call `get-design-system` once for the effective selection and
   use its hydrated context.
3. Plan the outline and theme contract: topic, audience, thesis, one message per
   page, visual direction, approximate page count, text density, motion, and
   known fit risks. If the prompt lacks its topic or audience, ask for those
   essentials before drafting. Bundle any other missing high-impact choices,
   such as visual direction, page count, text density, or motion, into one
   concise, topic-specific follow-up with a recommended direction. Do not ask
   for details the user already supplied.
4. When all pages can be authored before any deck exists, call `create-deck`
   once with every ordered page so the deck is saved atomically. In the Home
   prompt flow, an empty deck may already be persisted before the agent starts;
   use its supplied deck ID and call `add-slide` sequentially, without creating
   another deck. Before the first Home `add-slide`, call `get-deck` with
   `{ id: deckId, compact: "true" }` and apply its `designSystem.agentContext`
   and `deckStyle`; if the design system scope is `summary`, call
   `get-design-system` once with its ID. For other genuinely live generation,
   create the empty deck with `slides: []`, then add one `sourceTsx` component
   per page. Do not issue
   parallel writes to the same deck. Pass presenter notes through `notes`,
   outside the component source. Before the first incremental write, assign
   each planned page a distinct stable `slideId`. Reuse its ID and exact source
   or content and notes
   on retry. If `duplicate_slide_id` is returned, call `get-deck` with
   `slideIds: [slideId]` and `compact: false`, then treat it as saved only when
   the persisted source or content and notes match; otherwise stop and report
   the conflict. Identical slide content can still represent separate pages,
   so keep their IDs distinct. Omitting
   `slideId` remains supported, but the action generates an ID that cannot be
   reused safely after an unclear result.
5. For source files using `export default [Cover, Body]`, `create-deck` splits
   the local static components into separate ordered SQL slides (maximum 40).
   An optional static `export const notes = [...]` maps by page index; missing
   entries remain empty. A static `Cover.transition = {...}` is preserved as
   that page's transition override, with the module `transition` export as the
   default. Module-level static exports such as `meta` remain in each split
   page's source. For live `add-slide`, send one component per call.
6. Read the first new page with `get-slide-source` and inspect its derived
   preview with `get-deck`. Reuse the visual contract on later pages. After all
   writes, call `get-deck` once with `compact=true` and the created slide IDs to
   confirm the persisted count and IDs. Then call `get-layout-overflows` and
   `audit-contrast` once each; repeat only after a repair has produced a new
   measurement.
7. If `create-deck` returns `postProcessStatus: "failed"`, the deck write still
   committed. Read the deck, then call `navigate` if the connected browser did
   not move to it; do not repeat creation. Otherwise, if the browser does not
   consume the navigation command, call `navigate` with the deck id.

When continuing generation, call `get-deck` first and treat persisted
`generationContext` as canonical. Continue the original outline instead of
replacing it with a new topic inferred from the follow-up.

## Built-in templates

When the user wants to browse or choose a built-in starter, use
`list-deck-templates` to find its exact ID. For an exact copy, call
`create-deck-from-template`; it creates an independent SQL deck without AI,
provider setup, or the workspace default design system. If the user wants new
content in a starter's visual style, call `get-deck-template` to inspect its
slides and notes, then author a new source-backed deck with `create-deck` or
`add-slide`. Do not replace the starter or imply that copying it generated new
content. Built-in starters are shared catalog entries, so no owner filter is
needed when listing or reading them. The copy action checks the caller-scoped
saved row before reporting success. Supply a stable `newId` when a retry may be
needed; a matching retry returns the existing copy without overwriting edits,
and a mismatched owner, organization, template version, or original title is a
conflict. If readback fails, use the returned `deckId` to inspect the saved
deck before starting another copy.

If the user selects a bundled visual theme, read it with `list-slide-themes`
and `get-slide-theme` before authoring. Apply its guide through the
`design-systems` skill; it is distinct from a copyable deck template and a
linked SQL design system. Include `export const meta = { theme: "<theme-id>" };`
in every generated slide module so each saved slide retains the selected theme
ID in its static metadata. A `create-deck` page array preserves that module
export on every split page.

## Source contract

Each generated SQL slide stores one default-exported React page component in
`sourceTsx`. The action validates it, saves the canonical source, and derives
the `content` preview. React modules that need imports have an empty derived
HTML preview; the editor and presenter render their Worker artifact inside an
opaque-origin sandbox. Never write generated slides via `content`; that field
is for imported or legacy HTML and the derived static preview only.

The Slides 2 editor's browser PDF export calls `get-slide-render` and captures
its Worker-rendered sandbox output. The editor's editable PPTX export first
calls the `export-pptx` action, then uses the browser DOM-to-PPTX builder when
that action returns `source_runtime_export_required` for a source slide that
needs Worker rendering. The `export-pptx` action attempts bounded server-side
static rendering for source-only slides first. `export-html` and
`export-google-slides` require a saved static `content` preview, as do source
slides the PPTX evaluator cannot render. The public shared viewer cannot call
`get-slide-render` because it has only a share token, not deck viewer access.
New share snapshots mark source-only slides and show a capability message
instead of a blank slide; the shared PresentationView PDF path also rejects
those slides. Recreate older share links created before this marker was added
to identify source-only pages.

The supported module uses one default component and may import React plus these
eleven Worker-supported values from `@open-slide/core`: `CANVAS_WIDTH`,
`CANVAS_HEIGHT`, `defaultDesign`, `designToCssVars`, `Step`, `Steps`,
`useSlidePageNumber`, `useIsActivePage`, `ImagePlaceholder`, `MorphElement`, and
`cssVarsToString`. `cssVarsToString` is a pure, bounded serializer for safe CSS
custom-property maps; its output is text and does not enable runtime stylesheet
injection. Use the `ImagePlaceholder` props `hint` and optional `width` and
`height`; the Worker renders a static image slot, and asset replacement uses
the editor's image actions. For videos, use a static React `<video>` element
with an uploaded asset handle; see `slide-editing/references/video.md` for the
source and editing workflow. Use inline style objects or static CSS blocks to
style the slide.
`defaultDesign` is frozen in the Worker, and
`designToCssVars(defaultDesign)` can be spread into an inline `style` object.
The module may also export static `design`, `meta`, and `transition` objects.
Do not add other modules, dynamic imports, browser APIs, top-level effects, or
event handlers. The source is validated before it is bundled for a bounded
Worker render; it is not evaluated by the server or same-origin app. A Worker
timeout, size limit, and output sanitizer fail the render instead of
substituting a blank success.

Slide components render to static markup in a bounded Worker, so React effects
do not run. For motion, use sanitized CSS `@keyframes` or the existing
`<Steps>`/`<Step>` reveals.

The Worker supports `Steps`/`Step`, `useSlidePageNumber()`, and
`useIsActivePage()`. These provide page context and reveal state in static
markup. A render artifact carries validated module or page transition metadata
for the presenter host. `MorphElement` adds the stable `data-osd-morph` marker
used by cross-page matching.

Use standard JSX and inline `style` objects. `className` works when paired with
a static CSS string in a local `const` whose name includes `style`, `css`, or
`keyframe`; that CSS is sanitized and scoped to the slide root before it is
injected in the iframe. Tailwind utility classes have no stylesheet in the
frame, so they render unstyled. Do not use CSS imports, `<style>` elements,
`@import`, remote fonts, or CSS resource URLs. Images use uploaded `asset://`
handles only. Videos use uploaded MP4 or WebM `asset://` handles only. Use the
editor's asset browser to upload a video, then call `list-assets` with
`media: "video"` or `media: "all"` to find registered uploads; the action
defaults to images. In new `sourceTsx`, use the returned `assetId` as the
`<video>` `src` handle, and use an uploaded image handle for an optional
`poster`. Do not invent or embed remote media URLs, or use image-generation
actions for video. When changing an existing source-backed slide, read it with
`get-slide-source`, save with `update-slide-source` using the returned
`revision` and `sourceHash`, then read it back. Do not write source-backed
slides through legacy `content` fields. Keep local style rules and markup
self-contained; the action rejects arbitrary module imports, dynamic CSS
access, and network-capable asset references.

For a non-system typeface, search with `search-google-fonts`, then import the
chosen family and variant with `import-google-font({ deckId, family, variant })`.
The import validates and stores the font binary through configured file
storage. Apply its returned `family` and `assetId` to `displayFont` or
`bodyFont` through the visual editor or `update-deck-design-tokens`; the
renderer loads only those registered handles. Source code still cannot declare
`@font-face`, remote font URLs, CSS imports, or other network-capable CSS.

For multi-page generation, `create-deck` accepts a static
`export default [Cover, Body] satisfies Page[]` of local component functions
and splits it into ordered SQL slides (up to 40 per module). This is a
per-module fan-out bound; it is not a persisted deck or rendering limit. An
optional static
`export const notes = [...]` maps by page index; missing entries stay empty,
and the array may be shorter than the page list. Each saved slide gets its own
default component source, revision, hash, and derived preview; the original
file module is not stored as a shared object. For live `add-slide`, send one
default-exported component per call. Presenter notes may also be passed
through the slide action's `notes` field.

## Theme and composition

Use the same canvas, typography pairing, palette, spacing scale, and accent on
every page; vary composition, not the deck theme. With a linked design system,
use the shared deck-token variables. Without one, choose subject-appropriate
values once and repeat them across pages.

```tsx
export default function Cover() {
  return (
    <main
      style={{
        width: 1920,
        height: 1080,
        boxSizing: "border-box",
        padding: "128px 160px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 32,
        "--deck-bg": "#10261C",
        "--deck-ink": "#F2EFE6",
        "--deck-muted": "#A8B8AC",
        "--deck-accent": "#7FB069",
        "--deck-heading-font": "Georgia, serif",
        "--deck-body-font": "Arial, sans-serif",
        background: "var(--deck-bg)",
        color: "var(--deck-ink)",
        fontFamily: "var(--deck-body-font)",
      }}
    >
      <h1 style={{ color: "var(--deck-accent)", fontSize: 88 }}>
        A clear thesis
      </h1>
      <p style={{ fontSize: 36 }}>One message, composed for the room.</p>
    </main>
  );
}
```

At the native 1920×1080 canvas, keep body text at least 32px and split dense
material across more pages instead of shrinking it. Keep content in normal
flex/grid flow, leave text containers free to grow, and do not hide overflow
with transforms, clipping, or scrolling. Use images for complex visuals rather
than approximating them with piles of CSS shapes.

Read `design-systems` before theme work, `slide-design` for visual craft,
`slide-editing` before editing an existing slide, and
`references/reference-inputs.md` or `references/source-material.md` when their
inputs apply. `references/slide-templates.md` contains legacy HTML examples;
use them only when preserving or editing imported HTML slides.
