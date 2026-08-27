# Figma interoperability and fidelity contract

This is the acceptance contract for Figma interoperability in Design. It is
deliberately stricter than a feature checklist: a path is only **exact** when
the original visual result and the relevant editable semantics survive. A
rendered fallback can be pixel-faithful while still losing editability, so it
is reported separately.

Figma's REST API exposes file/node JSON and rendered exports, but it does not
offer a general REST operation for creating arbitrary native canvas layers.
Native canvas writes belong to Figma's official MCP/Plugin API path. The `.fig`
container and Figma clipboard binary are private formats and can change without
notice. Those boundaries make a universal lossless round trip impossible; the
product must report them instead of claiming success.

## Capability matrix

| Workflow or feature          | Current behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Fidelity                                                                                                                                                                                                   | Required verification                                                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Figma frame URL / file key   | Reads the exact node through `file_content:read`, converts it to a new Design screen, mirrors expiring images into durable storage, and returns a per-node fidelity report.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Mixed; see node matrix below.                                                                                                                                                                              | REST fixture, authenticated file, screenshot comparison.                                                                                                                                 |
| Figma URL without a node id  | Imports the first top-level object on the first page. A specific frame URL is recommended for deterministic results.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Same as node import.                                                                                                                                                                                       | Multi-page and empty-page fixtures.                                                                                                                                                      |
| Figma branch URL             | Uses the branch key and imports that branch's node.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Same as node import.                                                                                                                                                                                       | Main/branch pair with divergent content.                                                                                                                                                 |
| Figma clipboard to Design    | Uses private `figmeta.selectedNodeData` ids when present, then the same REST converter. With a token: full fidelity matching `import-figma-frame`. Without a token: local Kiwi binary decode — geometry, auto-layout, text, solid fills, and strokes are editable; image fills are stamped with `data-figma-image-ref="<sha1>"` placeholders and can be resolved retroactively two ways: token-free by uploading the original `.fig` (the paste dialog's "Fill images from .fig" / `hydrateFileIds` on the `.fig` upload route), which matches each placeholder hash to the `.fig`'s embedded image bytes; or with a token via `hydrate-figma-paste-images`. | Exact selection identity while Figma's private metadata shape remains compatible; node fidelity is mixed. No-token imports resolve images retroactively — from the `.fig` (no quota) or a connected token. | Real Chrome copy from single, multi, nested, and 100+ node selections; token-less copy followed by `.fig` hydration and by deferred token connect, verifying image resolution both ways. |
| `.fig` upload                | Bounded best-effort decoding of known Kiwi/ZIP variants into editable HTML. Embedded images are moved to durable storage. Optionally accepts a Figma frame URL: when its `node-id` matches the decoded file, Design imports only that top-level frame (or its ancestor for a nested node); a mismatch imports all frames with a warning. No Figma REST API calls are made.                                                                                                                                                                                                                                                                                   | Experimental. The format is proprietary and has no compatibility guarantee.                                                                                                                                | Corpus of real files from multiple Figma versions; never only generated containers.                                                                                                      |
| `.fig` upload + frame URL    | Accepts an optional Figma frame link. Normalizes the node-id and matches the decoded .fig GUID (`sessionID:localID`) to the matching top-level frame. Nested node IDs resolve to their top-level frame. On mismatch, all frames are imported. No Figma API quota is used.                                                                                                                                                                                                                                                                                                                                                                                    | Best-effort. The GUID mapping is reliable for frames in the same file but undocumented — test with real files before relying on it.                                                                        | Real .fig/frame-link pairs from Figma across file versions.                                                                                                                              |
| Design to Figma clipboard    | Copies an SVG built from the live rendered DOM. Figma imports supported SVG primitives as editable layers, including live editable text.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Visual/vector handoff, not a native semantic round trip. Auto layout, variables, components, prototypes, HTML state, and code identity are not recreated by SVG.                                           | Paste into real Figma and inspect layer types, text, images, effects, clipping, and bounds.                                                                                              |
| Design SVG download          | Same conversion as clipboard, with a server-render fallback when a live DOM is unavailable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Same SVG limits; the export report lists approximations and omissions.                                                                                                                                     | Live and server paths, selected layer and whole screen.                                                                                                                                  |
| Native Design to Figma write | Use Figma's official MCP `use_figma` write-to-canvas path when the connected client/account supports it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Native Figma structures, subject to Figma MCP beta limitations and permissions.                                                                                                                            | Full-seat/edit-permission account and a real destination file.                                                                                                                           |
| `.fig` download              | Not supported. There is no documented public `.fig` authoring contract.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Unsupported.                                                                                                                                                                                               | Do not label SVG/ZIP as `.fig`.                                                                                                                                                          |
| Open-ended Figma chat        | Provider catalog/docs/request expose the REST surface allowed by the user's scoped token; non-read calls require approval. Native canvas authoring requires official Figma MCP, not a personal access token alone.                                                                                                                                                                                                                                                                                                                                                                                                                                           | Endpoint-dependent.                                                                                                                                                                                        | Read scopes, expired/revoked token, rate limiting, Enterprise-variable permissions, MCP connection.                                                                                      |

## REST node conversion matrix

| Figma construct                                                            | Representation in Design                                                                                                                             | Fidelity and residual limit                                                                                                                                                                                              |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Frames, groups, sections, rectangles, full ellipses                        | Nested HTML boxes with fixed imported geometry.                                                                                                      | Exact at the imported canvas size for supported paints/effects.                                                                                                                                                          |
| Horizontal/vertical auto layout                                            | Flexbox with direction, padding, gap, wrap, alignment, FILL/HUG sizing, and min/max sizes. Absolute children remain out of flow.                     | Strong structural mapping, but Figma and browser layout engines are not identical. GRID and less common layout flags need golden comparison.                                                                             |
| Nested freeform positioning and clipping                                   | Parent-relative absolute geometry; `clipsContent` becomes `overflow:hidden`.                                                                         | Exact for axis-aligned bounds.                                                                                                                                                                                           |
| Rotation                                                                   | CSS rotation reconstructed from the post-rotation bounding box.                                                                                      | Approximated because the pre-rotation box/pivot requires geometry transforms. Listed in the fidelity report.                                                                                                             |
| Solid and multi-layer fills                                                | CSS background layers in Figma stacking order.                                                                                                       | Exact for supported paint stacks.                                                                                                                                                                                        |
| Linear gradients                                                           | CSS gradient derived from Figma handles in pixel space.                                                                                              | Exact for the supported linear model.                                                                                                                                                                                    |
| Radial/angular/diamond gradients                                           | CSS radial/conic approximation.                                                                                                                      | Approximated and reported.                                                                                                                                                                                               |
| Image fills                                                                | Durable mirrored URL with FILL/FIT/TILE/STRETCH.                                                                                                     | Exact for axis-aligned transforms. Filtered, rotated, or skewed crops become rendered fallbacks. Missing image URLs fail the import instead of silently disappearing.                                                    |
| Text                                                                       | Editable text with font family, size, weight, italic, line height, tracking, alignment, case, decoration, whitespace, and ordinary mixed-style runs. | Exact only when the same font is available and the feature is representable by CSS. Lists, paragraph typography, hyperlinks, OpenType overrides, gradient/image text, and other advanced runs become rendered fallbacks. |
| Uniform solid strokes                                                      | Border/outline/inset-shadow mapping according to alignment.                                                                                          | Exact for the covered model. Per-side CENTER/OUTSIDE is approximated and reported.                                                                                                                                       |
| Multiple, dashed, gradient, or image strokes                               | Rendered PNG fallback for the smallest affected subtree.                                                                                             | Pixel-oriented fallback; not structurally editable.                                                                                                                                                                      |
| Drop/inner shadows                                                         | CSS shadows.                                                                                                                                         | Exact for ordinary CSS-compatible shadows. Non-normal effect blending becomes a fallback.                                                                                                                                |
| Layer/background blur                                                      | CSS filter/backdrop-filter.                                                                                                                          | Approximated because Figma's radius mapping is not a public 1:1 contract.                                                                                                                                                |
| Blend modes                                                                | CSS `mix-blend-mode` when available; closest mapping for a few Figma-only modes.                                                                     | Exact or approximated as reported. Paint/effect blend modes that cannot be preserved become fallbacks.                                                                                                                   |
| Lines, partial/ring ellipses, vectors, boolean operations, stars, polygons | Rendered fallback requested from Figma.                                                                                                              | Visual fallback, not editable geometry. Figma caps rendered images at 32 megapixels and may downscale them.                                                                                                              |
| Masks                                                                      | The smallest container whose children participate in the mask is rendered as one fallback.                                                           | Preserves visual composition, loses structural editability within that subtree. Alpha/vector/luminance masks are not misrepresented as ordinary layers.                                                                  |
| Components, instances, and variants                                        | Resolved child visuals become HTML; component id/properties remain bounded `data-figma-*` metadata.                                                  | Visual conversion plus provenance, not a live link to the Figma master. Instance swaps/variant semantics do not round trip through HTML/SVG.                                                                             |
| Variables                                                                  | Resolved visuals are imported and `boundVariables` ids remain bounded metadata.                                                                      | Bindings are not live Design tokens. Full variable enumeration also depends on Enterprise plan/seat/scopes.                                                                                                              |
| Prototype interactions                                                     | Preserved as inert metadata.                                                                                                                         | Deliberately do not navigate the editor iframe. No executable prototype round trip yet.                                                                                                                                  |
| Videos, emoji paints, FigJam-only and unknown node types                   | Rendered fallback when Figma can render the node.                                                                                                    | Visual fallback only.                                                                                                                                                                                                    |
| Hidden or 0%-opacity subtrees                                              | Omitted without downloading their assets.                                                                                                            | Visually exact and avoids unnecessary work.                                                                                                                                                                              |

## Measured Figma SVG import behaviour

Figma's SVG importer was probed directly (file `K5hsbrwOsZfFkoPuTwk4l3`, via
`figma.createNodeFromSvg`, reading the resulting nodes back through the Plugin
API). These are measurements, not assumptions, and they bound what any
SVG-based export can achieve.

**Honoured.** Frame/group structure, path and rect geometry, per-corner radii,
solid fills, `fill-opacity` / `stroke-opacity` / `stop-opacity`, linear and
radial gradients with `userSpaceOnUse` geometry, `clipPath`, rotated groups,
image `href`, font family, font size, and a coarse bold weight. Text arrives as
**live editable `TEXT` nodes**, not outlined paths.

**Shadows are not imported as effects — at all.** Every `feDropShadow` variant
tested (default filter region, explicit region, `filterUnits="userSpaceOnUse"`,
hex vs `rgb()` flood, with and without `flood-opacity`, two stacked drop
shadows) produced a node with an empty `effects` array. Worse, a composed
`feMorphology`/`feGaussianBlur`/`feOffset`/`feFlood` chain — the only way to
express spread or inset in SVG — was mapped to a `LAYER_BLUR` that blurs the
element itself, which is more damaging than losing the shadow.

The one filter primitive Figma maps to something useful is a bare
`feGaussianBlur`, which becomes a `LAYER_BLUR` on the filtered node. So the
export emits **shadows as geometry, never as a filter on the shape**: a blurred,
offset, spread-adjusted copy of the shape painted behind it for a drop shadow,
and an inverted ring path clipped back to the shape for an inset shadow. Spread
is applied to the geometry, so `feMorphology` is not needed. This renders
identically in a browser and arrives in Figma as a blurred layer in the right
place — verified visually for both drop and inset shadows.

**Silently ignored.** Every one of these was tested and had no effect on the
imported node:

| SVG mechanism                              | Result in Figma                         |
| ------------------------------------------ | --------------------------------------- |
| `letter-spacing` attribute                 | dropped, node reports 0                 |
| `letter-spacing` in a `style` attribute    | dropped                                 |
| `textLength` + `lengthAdjust="spacing"`    | ignored, natural width                  |
| multi-value `tspan x="0 45 90 …"`          | ignored, glyphs set solid               |
| sibling `tspan`s each with their own `x`   | flattened into one run at the first `x` |
| `word-spacing`                             | ignored                                 |
| family-encoded weight (`"Inter Extra Bold"`) | resolves to `Inter Regular`           |
| `font-weight` 800 or 900                   | both resolve to `Inter Bold`            |
| `dominant-baseline`                        | ignored; `y` is read as the baseline    |

Two consequences the export must live with, and reports rather than hides:

1. **Tracking cannot survive as editable text.** The only construction Figma
   places exactly is one `<text>` element per glyph, which would turn every
   headline into one node per character. The export keeps editable text and
   records the deviation in `vectorizedTextCaveat`.
2. **Weights above 700 collapse to Bold.**

Because `dominant-baseline` is ignored, the export emits the true alphabetic
baseline in `y`. That is also SVG's default, so Chromium and Figma agree.

## Import fidelity harness

`pnpm figma-fidelity:import` is the mirror of the export harness. It reads a
real Figma node through the REST API, runs the REAL `mapFigmaNodeToHtml`
converter — the same pure function `import-figma-frame` uses, so a fix here is a
fix in the product — renders the resulting HTML headless, and pixel-diffs it
against Figma's own render of that node.

It needs a Figma personal access token with `file_content:read` in
`FIGMA_FIDELITY_TOKEN`. That is deliberately NOT the app's `FIGMA_ACCESS_TOKEN`
vault key: this is a local QA entry point, and the app's credential keeps its
single vault-backed resolver. Every REST response and reference render is cached
under `.tmp/figma-fidelity/import-cache/`, because Figma allows only 10-20 Tier 1
requests per minute and an uncached re-run would spend the budget re-fetching
instead of on new cases.

Cases live in `scripts/figma-fidelity/import-corpus.json` as
`{"id", "url", "stresses"}`. Artifacts land in
`.tmp/figma-fidelity/import/<case>/` as `figma.png` (the reference),
`import.png` (ours), `diff.png`, `node.json` (the source data, so a bug can be
traced to the exact paint or layout property) and `fidelity.json`.

A null render or a missing reference is raised, never skipped: a case that
quietly disappears from the table reads as progress.

`--offline` replays a case purely from the cache and the saved reference. It
never falls back to the network and never treats a missing response as an empty
one — an uncached request under `--offline` names exactly what is missing. This
exists because Figma's Tier 1 budget is per FILE, so a Community file duplicated
into Drafts stays exhausted for days and would otherwise stop all converter work
on precisely the complex real-world designs that matter most.

## `.fig` upload fidelity harness

`pnpm figma-fidelity:fig` covers the second import route. The `.fig` path is a
SECOND, independent converter (`fig-file-to-html.ts`) from the REST one
(`figma-node-to-html.ts`); two walkers over the same design drift apart, and the
drift is invisible until something measures both against one reference. Each
frame gets two numbers:

- `vsFigma` — against Figma's own PNG, reusing the reference the import harness
  cached. The real fidelity number.
- `vsRest` — against the REST importer's render of the same frame. Pure
  cross-path drift, and it needs no Figma request at all, so it stays
  measurable while the REST quota is exhausted.

Frames line up across paths for free: a `.fig` GUID is `sessionID:localID`,
exactly the shape of a REST node id.

A partial decode (`decodeError`) fails the case rather than scoring a document
that is quietly missing nodes. The harness raises the product's per-frame byte
budget on purpose: it inlines images as base64 so a `setContent` page can
resolve them, where the product carries short durable URLs, and measuring the
product budget against inflated bytes would fail files the product imports fine.
Those budgets have their own coverage in `fig-file-import.test.ts`.

## Clipboard paste fidelity harness

`pnpm figma-fidelity:paste` covers the third route. A clipboard payload shares
the `.fig` walker but not its input: it is a kiwi buffer holding a node SUBTREE
with no DOCUMENT/CANVAS above it, so it goes through `normalizeClipboardDocument`
first, and it carries NO image bytes — only 20-byte hashes that
`hydrate-figma-paste-images` resolves later once a token is connected.

Read the number accordingly: every image fill renders as an `about:blank`
placeholder, so a photography-heavy design scores a large diff by design. The
table prints `noImg` beside the diff so the number stays interpretable instead
of looking like a converter regression.

Payloads are captured from a real Figma copy, never synthesized. To capture one,
open the file in a browser, select the frame, install a capture hook, and use
the canvas context menu's plain **Copy** — a synthetic `cmd+c` will not work
because Figma ignores untrusted key events, and `Edit ▸ Copy as` only offers
PNG/SVG/text, not the kiwi buffer:

```js
window.__cap = null;
navigator.clipboard.write = new Proxy(navigator.clipboard.write.bind(navigator.clipboard), {
  apply: async (t, _s, [items]) => {
    for (const i of items)
      if (i.types.includes("text/html")) window.__cap = await (await i.getType("text/html")).text();
    return t(items);
  },
});
```

Then save `window.__cap` to `.tmp/figma-fidelity/clipboard/` and add a
`{"id", "file", "reference"}` entry to `scripts/figma-fidelity/paste-corpus.json`.

## REST import and export, measured on 23 designs

Every case resolves against a node inside the paid team (see below for how to
get one there), so the REST path measures again instead of failing on
Starter-tier limits. `import%` is our HTML against Figma's own render of the
same node; `export%` is the SVG Figma receives, scored against that same
reference; `drift%` is what the export hop alone costs. `non-text%` is the same
import comparison with every TEXT node's box excluded.

Measured 2026-08-27:

| case | size | import% | non-text% | export% | drift% |
| --- | --- | --- | --- | --- | --- |
| dashstack admin | 1440x1070 | **1.20** | 0.21 | 1.20 | 0.01 |
| untitled UI settings | 1440x2578 | **1.24** | 0.46 | 1.11 | 0.45 |
| interior eCommerce | 1440x4835 | **2.06** | 1.30 | 2.70 | 2.38 |
| constraints | fixture | 2.33 | 0.11 | 2.29 | 0.16 |
| untitled UI landing alt | 1440x6734 | 2.62 | 0.93 | 2.50 | 0.90 |
| untitled UI landing | 1440x7060 | 2.65 | **0.52** | 2.76 | 0.62 |
| untitled UI pricing | 1440x4538 | 2.89 | **0.27** | 2.83 | 0.86 |
| parity-stress | fixture | 2.94 | 0.87 | 3.28 | 0.94 |
| untitled UI dashboard tall | 1440x1315 | 3.03 | 1.45 | 3.11 | 1.02 |
| card-grid | fixture | 3.14 | **0.06** | 3.14 | 0.00 |
| autolayout | fixture | 3.48 | 1.03 | 4.60 | 1.76 |
| ds table variants | 3350x3277 | 3.69 | 1.23 | 3.69 | 0.00 |
| whitepace SaaS | 1440x9631 | 3.77 | 1.44 | 3.50 | 1.69 |
| untitled UI dashboard | 1440x960 | 3.89 | 1.32 | 4.23 | 1.05 |
| landify example | 1440x21306 | 3.94 | 2.16 | 3.57 | 1.37 |
| untitled UI data table | 1216x899 | 3.96 | 0.82 | 4.45 | 0.84 |
| untitled UI settings mobile | 375x2366 | 4.02 | 0.47 | 3.97 | 0.84 |
| positivus landing | 1440x8356 | 4.18 | 2.38 | 4.65 | 1.72 |
| landify tablet | 768x5585 | 4.88 | 2.20 | 4.66 | 1.54 |
| fills-effects | fixture | 5.98 | 5.98 | 6.48 | 0.02 |
| untitled UI landing mobile | 375x8925 | 6.43 | 1.32 | 6.53 | 1.15 |
| typography | fixture | 13.27 | **0.005** | 13.19 | 0.19 |
| shapes | fixture | **0.54** | 0.54 | 0.29 | 0.31 |
| **mean** | | **3.74** | **1.18** | | |

**The export hop costs under 2.5% on every design**, so `import%` is the number
that matters — and two thirds of THAT is glyph rasterisation. Excluding text
boxes the mean falls from 3.74% to 1.18%, and `typography` — the fixture built
to stress text — falls from 13.27% to **0.005%**. Nothing but glyphs is wrong
on it. Figma and Chromium hint and antialias differently, and one pixel of
difference on black-on-white body text scores a full 255 delta; see the Inter
section for the measurement ruling out a font-version mismatch as the cause.
Mobile cases read highest because a narrow column reflows on a smaller
difference. `fills-effects` is the one case where the residual is NOT text: it
has no text at all, and what is left is the antialiasing of a diamond gradient
and a background blur.

A per-node geometry audit (every node's laid-out box against its own
`absoluteBoundingBox`) is the sharper instrument for the parts the converter
controls, because a 200px layout error is invisible next to glyph noise. After
this work, 11 of 23 designs have NO node off by more than 1.5px, and only one
design has any node off by more than 10px — all of them text boxes that wrap
differently.

What moved the numbers. Each was a real defect on a real design:

| defect | case | before | after |
| --- | --- | --- | --- |
| render clamped at 16384px, compared against a full-size render | landify | 24.38 | 3.94 |
| whole-file image map cached by path, so later fills resolved to nothing | untitled UI landing | 9.34 | 2.65 |
| exported artboard clipped content past the frame | dashboard (export) | 12.05 | 4.23 |
| tiled gradient flattened on export | fills-effects (export) | 13.30 | 6.48 |
| ink extent vs frame box: a 2px shadow shifted every pixel | data table | 10.33 | 3.96 |
| diamond gradient approximated as an ellipse | fills-effects | 12.07 | 5.98 |
| FILL child inside a HUG parent collapsed to zero | landing mobile | 10.65 | 6.43 |
| a mirrored group rendered as a 180-degree rotation | positivus | 5.94 | 5.76 |
| SPACE_BETWEEN row also emitting its stale itemSpacing | positivus | 5.45 | 4.74 |
| empty hugging frame collapsed to zero | whitepace | 6.23 | 3.62 |
| negative overlap not clamped to the child's own size | positivus | 4.74 | 4.23 |
| rotated child taking its pre-rotation width in the row | positivus | 5.76 | 5.45 |
| HUG container sized from a cross-axis FILL child's content | positivus | 4.23 | 4.18 |
| trailing CR rendered as an extra line | whitepace | (67 nodes) | (53) |

Four of those were defects in the HARNESS rather than the converter — it
reported conversion error where the measurement itself was wrong. A fidelity
number is a claim about the converter, so the harness has to be at least as
trustworthy as the thing it grades.

## Measured drift between the three import paths

Numbers from the Positivus landing page (`330:762`, 1440x8356) and the Untitled
UI v2 desktop landing page (`1647:376184`, 1440x7060, vertical auto-layout
throughout), both measured against Figma's own render.

| Fix | paste vs Figma | converter only |
| --- | --- | --- |
| baseline | 23.53% | — |
| AUTO line height | 19.11% | — |
| masks (fill + stroke) | 14.12% | 12.60% |
| auto-layout overlap + no-shrink | 8.66% | 7.08% |
| flipped transforms, ellipses, parametric shapes | 8.37% | 6.75% |

"converter only" is `vsFigma` with the image-fill placeholders excluded — a
clipboard payload carries image hashes but no image bytes, so those boxes
measure a documented absence rather than the converter. The harness prints
both, and reports the excluded area, so a shrinking denominator can never read
as a rising score.

Further defects the same comparison found, all in the shared `.fig`/clipboard
walker:

- **Override precedence was inverted.** Figma resolves a descendant against the
  OUTERMOST instance that overrides it — that entry is the edit someone made on
  the instance they placed, while a nested instance's entry belongs to the
  component it came from. Merging outer-to-inner let the component's own value
  win and silently undo the edit: Untitled UI's header rendered
  "Resources / Resources" where Figma has "Products / Resources".
- **Auto-layout children shrank.** Figma keeps a non-growing child at its own
  size and lets the parent overflow; CSS flex items shrink by default, so
  Positivus' 1240px CTA card rendered at 897px.
- **Negative `stackSpacing` was emitted as a negative `gap`,** which CSS
  rejects outright. Figma also CLAMPS it so the children still fill a fixed
  container: -715px between a 1240px card and a 494px illustration in a 1240px
  box resolves to -494px, putting the illustration at x=846 rather than 625.
  The clamp is `max(spacing, (available - sum) / (n - 1))`.
- **A mirror was rendered as a 180 degree rotation.** The guard tested
  `|determinant|`, which erases the sign, so `m00 = -1, m11 = 1` (a horizontal
  flip, no off-diagonal terms) matched neither the scale nor the skew branch
  and fell through to `rotate(180deg)` — which moves a box up and left by its
  own size. Positivus' flipped CTA illustration landed 394px above its frame.
  Anything that is not a pure rotation now goes through the matrix.
- **Full ellipses were dropped as "geometryless vectors".** `border-radius:
  50%` reproduces one exactly, fill and stroke included; suppressing it just
  deleted the shape, and Positivus' three stroke-only CTA rings vanished. An
  arc or donut (`arcData` narrower than a full turn, or a non-zero inner
  radius) is still not expressible and stays suppressed — but is now recorded
  in `approximatedNodes` instead of disappearing silently.
- **STAR and REGULAR_POLYGON had no geometry to draw.** A clipboard payload
  gives them neither flattened geometry nor a vector network, only `count` and
  `starInnerScale`, so the shapes were dropped entirely. Those parameters
  describe the outline exactly and are now synthesised.

After these, every node in Positivus' CTA block lands on Figma's own
coordinates: the card at 1240x347 @100, the illustration frame at 494x394 @846,
and each ellipse and star within a pixel of Figma's reported box.

Two defects the three-way comparison found, both in the shared `.fig`/clipboard
walker and both invisible to the REST path:

- **AUTO line height read as a font-size percentage.** Figma encodes AUTO as
  `{ value: 100, units: "PERCENT" }`, and the REST API calls those same nodes
  `lineHeightUnit: "INTRINSIC_%"` with `lineHeightPercentFontSize: null` —
  60px Space Grotesk resolves to 76.56px, not 60px. Every auto-height text box
  came out ~28% short and the error accumulated down the page: 17px per card
  row, 91px by the sixth. `line-height: normal` is the CSS spelling of the same
  rule and reproduces Figma's value exactly.
- **Masks not implemented at all.** The kiwi payload carries `mask: true` (the
  REST `isMask`), and the walker ignored it, painting the masked content at full
  size — a 1153x703 black rounded rectangle covering the Positivus contact form.
  The REST path never hit this because it hands masked groups to Figma to
  rasterize; the `.fig` path has no network, so it needs real CSS masking.

Masks come in two shapes and need two constructs:

- A mask that PAINTS A FILL becomes a `<clipPath>`.
- A mask that only STROKES has no fill area. Filling its outline turns a fan of
  hairlines into a solid blob — the Positivus sunburst became a filled star that
  way. Those become a `mask-image` data URI whose path is `fill="none"` with the
  stroke painted white.

Use a `mask-image` data URI, NOT `mask: url(#id)` against an inline `<mask>`:
Chrome ignores the fragment form on an HTML element, drops the declaration, and
paints the run unmasked — measured at 17.69% versus 14.12%, i.e. worse than the
filled-outline approximation it was meant to replace.

A mask this walker cannot express (no geometry, or an auto-layout parent, where
the out-of-flow wrapper would leave the stack it belongs to) is recorded in
`approximatedNodes` and left unmasked. An unexpressible mask must never delete
content.

Two REST-path defects the same comparison surfaced, where the `.fig`/clipboard
path is the CORRECT one:

- Positivus `330:762`: the sunburst vector renders oversized and shifted right,
  overflowing its card. Figma and the paste path both place it correctly.
- Positivus service cards: the "Social Media Marketing" title highlight renders
  green where Figma (and the paste path) render white.

## `templates/design` runs core's BUILT dist, not its source

`templates/design/server/lib/figma-node-to-html.ts` is a one-line re-export of
`@agent-native/core/ingestion`, whose export map points at `dist/`. A change to
`packages/core/src/ingestion/**` is invisible to the design suite and to every
fidelity harness until `packages/core` is rebuilt — the numbers keep reporting
the previous build, unchanged, which reads exactly like "no regression".

Run `npm run build` in `packages/core` before trusting a design-side number
after touching core, and put specs for core converters in
`packages/core/src/ingestion/*.spec.ts` where they test the source.

## Image fills are magnified with NEAREST sampling

Figma upscales an image fill with nearest-neighbour sampling; a browser upscales
with bilinear smoothing. Measured 2026-08-26 across a checkerboard edge on a
16x16 fill blown up to 180x90, on the same scanline:

```
x            ... 67           68           69           70
Figma            119,73,132   119,73,132   227,78,52    227,77,52
ours (before)    155,74,105   167,75,96    173,75,92    184,76,83
ours (after)     119,73,132   119,73,132   227,78,52    226,78,52
```

Figma steps in ONE pixel; the browser ramped across twelve. Every
low-resolution fill — a pattern, an icon, pixel art, a placeholder — imported
blurred.

`mapFigmaNodeToHtml` takes `imageFillSizes` (imageRef -> the image's own pixel
size) and asks for `image-rendering: pixelated` only when the box is
meaningfully larger than the image. ONLY when magnified: `pixelated` is nearest
in both directions, and a photo scaled down that way aliases badly. Without a
size the fill still renders, just smoothed — a missing size must never stop the
fill appearing.

The importer supplies it for free: `mirrorFigmaImageUrls` already downloads
every image to mirror it into storage, so the PNG/JPEG header is in hand. The
REST paint carries no intrinsic size, so there is nowhere else to get it
without a second fetch.

## Round-trip fidelity harness

`pnpm figma-fidelity:roundtrip` is the one that answers the question a user
actually has: after a design has gone into this app and back out to Figma, does
it still look like what they started with? The import and export harnesses each
measure one hop, and a converter can score well on one while losing the design
on the other, so this scores all three against ONE reference — Figma's own
render of the source node.

It reuses the artifacts the import and paste runs already produced, so it costs
no Figma quota and runs on the complex community designs rather than on
synthetic fixtures.

Measured 2026-08-26:

| case | import | export | export hop |
| --- | --- | --- | --- |
| card-grid | 3.14% | 3.14% | **0.000%** |
| constraints | 2.33% | 2.28% | 0.17% |
| typography | 13.27% | 13.19% | 0.19% |
| shapes | 0.54% | 0.29% | 0.31% |
| parity-stress | 2.79% | 3.27% | 0.73% |
| community untitled-ui landing | 2.65% | 3.07% | 1.63% |
| autolayout | 3.48% | 5.72% | 3.11% |
| untitled-ui (clipboard) | 12.90% | 12.88% | 0.14% |
| positivus (clipboard) | 8.37% | 8.63% | 2.16% |
| fills-effects | 14.33% | 23.38% | 9.70% |

**Load the fonts the SVG names before measuring it.** The exported SVG carries
`font-family` but no `@font-face` — Figma resolves families against its own font
list on import. Rendering it without them silently substitutes Arial for every
custom face, which shifts every glyph: that alone accounted for most of the
apparent export cost (typography 17.32% -> 0.19%, card-grid 2.99% -> 0.000%).
The caveat that survives is real, though: a family Figma does not have will
fall back there too.

**Inter: Google Fonts' current version is the right match — measured, not
assumed.** An earlier note here claimed Figma renders Inter 3.x, that Google
Fonts' 4.001 therefore drifts by 0.157-0.249% per advance, and that
self-hosting Inter 3.19 would recover about 3.3 points on `typography` and help
every Inter design. That was reasoning from release notes, and it is wrong.

Measured 2026-08-27 by rendering the same imported HTML twice — once against
Google Fonts, once with Inter 3.19 (`inter-ui@3.19.3`) embedded over it — and
scoring both against Figma's own render:

| direction | cases |
| --- | --- |
| Inter 3.19 is WORSE | 15 of 17 (card-grid 3.14 -> 22.54, landify tablet 4.88 -> 29.27, parity-stress 2.94 -> 11.82) |
| Inter 3.19 is better | 2 (`typography` 13.27 -> 9.98, settings-mobile 4.06 -> 3.65) |
| unaffected | designs that use no Inter (interior: 0.000 delta, which is the control) |

So Figma renders a modern Inter, and the shipped configuration already matches
it. **Decided 2026-08-26, and now confirmed by measurement: keep Google Fonts
at its latest version.** Do not self-host 3.19 — it would cost several points
across the corpus.

What that leaves is the more useful conclusion: the residual on text-heavy
pages is NOT a font-version mismatch. It is glyph rasterisation — hinting and
antialiasing differ between Figma's renderer and Chromium — and a one-pixel
difference on black-on-white body text scores a full 255 delta. That is why
`positivus` carries the corpus' highest mean delta while looking identical side
by side, and why every mobile case reads higher than its desktop twin: a
narrower column reflows on a smaller difference. It is not reducible by
choosing a different font file.

Three export defects the round trip found, none of which the single-hop export
harness could see because its own preset designs use none of them:

- **A conic gradient was dropped.** SVG has no angular gradient and the paint
  builder answered by omitting the layer, so Figma received a blank tile where
  the design has one — even though Figma itself supports angular gradients. A
  leaf carrying one is now rasterized, the same way `backdrop-filter` already
  was: pixel-accurate, and reported. `fills-effects` export hop 16.81% -> 9.70%.
- **A CSS clip-path or mask was ignored,** so a masked element exported at full
  size. On Positivus that is a black rectangle Figma only reveals through a
  starburst; unmasked it covered the entire contact form, and the band around
  it differed by 79.6%. Now rasterized. Positivus export hop 9.57% -> 3.95%.
- **A percentage border-radius exported as a rounded rectangle** (see below).
- **An unresolvable image href exported as a broken `<image>`.** The clipboard
  import cannot carry image bytes, so it points unresolved fills at
  `about:blank` until `hydrate-figma-paste-images` fills them in. Passing that
  through hands Figma a broken reference — and a renderer whose own document
  URL is `about:blank` resolves it to the document ITSELF, painting a recursive
  smear of the page where the design has a placeholder. Only `http(s):`,
  `data:` and `blob:` sources become an `<image>` now; anything else is
  reported as omitted, because an absent image and an unresolvable one are the
  same fact and neither is "here is a picture". Untitled UI's clipboard export
  hop 13.25% -> 0.14%, Positivus 3.95% -> 2.16%.

Rasterizing is deliberately restricted to leaves. Rasterizing a container would
flatten children that export perfectly well as geometry, and those children are
not walked once a node is rasterized, so they would vanish rather than double.

**Feed it the document the product PERSISTS, not the converter's fragment.**
`mapFigmaNodeToHtml` returns a bare `<div>` that only lays out correctly once
`figma-node-import.ts` wraps it with `withFigmaBoxModelReset` +
`withFigmaFontLoading` + `normalizeImportedHtmlDocument`. The first version of
this harness exported the fragment, so the exporter laid it out with the
browser's content-box default, every padded element grew by its padding, and
the run reported an export hop costing 12-23% — a harness artifact, not a
product defect. `run-import.ts` now writes `stored.html` next to `import.html`
for exactly this reason: anything measuring what happens AFTER import has to
start from the stored document.

The round trip also found a real export defect that neither single-hop harness
could see. `getComputedStyle` keeps a percentage border-radius AS a percentage,
and `parseFloat("50%")` is 50 — so a 125px circle exported as a rounded square
with 50px corners and a 338x71 ring collapsed into two near-straight lines. A
percentage now resolves against the element's own box per axis, and an element
that is a full ellipse on both axes is flagged so `roundedRectPath` draws two
half-turn arcs with independent `rx`/`ry`. That flag lives on the radii rather
than at each shape site, so fills, clips, shadows and outlines all pick it up
from the one path builder.

## Export fidelity harness

`templates/design/scripts/figma-fidelity/` is the acceptance loop for the
export path. `pnpm figma-fidelity:export` renders each case's stored HTML,
runs the real `renderDesignToFigmaSvg`, renders the resulting SVG, and pixel
diffs the two, writing `design.png` / `export.png` / `diff.png` plus a
`compare.json` naming the worst-differing regions. `pnpm figma-fidelity:sheet
<caseDir>` builds a labelled side-by-side. Cases live in
`scripts/figma-fidelity/corpus/<id>/{screen.html,meta.json}`; the built-in
design presets are included automatically.

The harness's own noise floor is 0.0000% (the same HTML rendered twice), so any
reported difference is real. Residual on the current corpus is dominated by
HTML-vs-SVG glyph rasterization, which differs on edge pixels even when every
glyph lands on the same subpixel; `text-rendering="geometricPrecision"` was
measured and made it worse, so Chromium's default is kept. Every case currently
reports zero omissions and zero approximations.

Fixes this loop found are pinned in
`server/lib/design-to-figma-svg.fidelity.spec.ts`, which carries the
per-case before/after table.

## Getting a Figma reference render with no API quota

Both Figma transports share one exhausted budget (see below), but Figma's own
**Export panel in the browser** does not touch either. Select the frame, open
Export at the bottom of the right-hand Design panel, add a setting, and export
PNG at 1x — the download is byte-for-byte what `/v1/images?scale=1` would have
returned, at the node's exact size.

Driving it: the panel does not scroll to Export with a mouse wheel, so find the
control by accessibility name (`Add export settings`, then `Export <width>px`)
rather than by coordinate. A tall frame takes Figma a minute or two to render
server-side.

This is how the corpus grows while the quota is out. It gives a reference for
the clipboard and `.fig` paths, which need no API at all; it does NOT unblock a
REST case, because that also needs the node JSON the REST API serves.

Two limits found while using it, both measured 2026-08-26:

- **A tall frame does not export.** 1440x773 downloaded in seconds; 1440x9631
  produced no file at all, with no error in the UI. Export a frame, not a whole
  page.
- **An exported node is rendered IN ISOLATION,** which is not the same pixels
  as that node sitting inside its parent: no page background behind it, no
  overlapping siblings, different clipping. Cropping the parent's render to the
  node's box and diffing the two gives 16.4% on Positivus' contact block, with
  no shift in +/-24px improving it — while the same region measures ~3.7%
  against the API's render of the whole parent frame. Compare a UI export only
  against a render of the SAME node, never against a crop of its parent.

## The REST limit follows the FILE's plan, not the account

Measured 2026-08-26, and this corrects an earlier note in this file that said
the opposite:

| file | status | `x-figma-plan-tier` |
| --- | --- | --- |
| a file in the Builder.io team | **200** | *(no rate-limit headers at all)* |
| a Community file open from Drafts | 429 | `starter`, `rate-limit-type: low` |

A Starter-tier resource gets ~6 Tier 1 requests per MONTH; a paid team's files
are not capped in practice. Three different personal access tokens were checked
against `/v1/me` and all resolve to the same user, so a new token cannot help —
what matters is which plan owns the FILE.

The earlier "per ACCOUNT" conclusion came from duplicating a Community file and
seeing the new key 429 too. That test was wrong: the duplicate landed in
**Drafts**, which is the same Starter space, so it proved nothing.

The same rule governs Figma's own MCP server: `get_screenshot` on a Drafts node
answers "You've reached the Figma MCP tool call limit on the Starter plan",
and the same call on a paid-team node returns the render.

**To unblock the REST corpus: get the design into a project inside the paid
team.** Community originals cannot be moved (they are not yours). Figma's own
UI routes for this were all dead ends in testing — the in-editor `Move file`
dialog never finished loading its project list, and cross-file paste,
`Save local copy`, and file-card context menus each wedged or no-opped.

What works is Figma's own clipboard, driven directly. Figma keeps a hidden
`div.focus-target` that handles `copy` and `paste`, and it accepts synthetic
events, so a whole design moves with no clicking and no quota:

1. In the source tab, open `?node-id=<id>` and give the app focus (any inert
   click, e.g. the `Design` tab). Without focus the copy handler returns
   nothing.
2. Dispatch a synthetic `copy` at the focus target with your own
   `DataTransfer`; Figma fills it in, and `dt.getData("text/html")` is the
   real clipboard payload.
3. **Verify what you actually copied.** The payload's `(figmeta)` block is
   base64 JSON whose `selectedNodeData` names the copied node. Figma's
   selection lags in-app navigation, so a copy fired too early silently
   returns the PREVIOUS node — retry until `selectedNodeData` matches the node
   you asked for. Skipping this check is how a corpus quietly ends up
   measuring the wrong design.
4. Hand it to the target tab through `localStorage` (both tabs are
   `figma.com`, so this costs nothing and avoids re-sending megabytes).
5. Dispatch a synthetic `paste` there with the same payload.

Two traps on the paste side, both of which corrupt geometry silently:

- **Paste goes INSIDE the current selection.** Reloading the target does not
  reliably clear it — Figma restores the previous selection, and `?node-id=0-1`
  (the page) does not clear it either. A frame with auto-layout then absorbs
  the paste and REFLOWS it; the giveaway is an existing frame whose height
  grows instead of a new sibling appearing. Paste into a FRESH, empty file —
  `create_new_file` on the Figma MCP takes a `planKey` and `projectId` and puts
  it straight in the paid team.
- **Confirm the node landed before moving on**, by polling REST for a new page
  child. A paste that reports handled has only reached the local editor; it is
  not durable until it syncs, and the editor discards it on reload.

## Figma REST rate limits

- Viewer and Collab seats may receive up to 6 Tier 1 requests per month for
  file, node, and image endpoints. The actual limit may be lower.
- Dev and Full seats receive 10–20 Tier 1 requests per minute, depending on the
  resource's plan.
- On HTTP 429, Figma returns `Retry-After` in seconds plus
  `X-Figma-Plan-Tier`, `X-Figma-Rate-Limit-Type`, and
  `X-Figma-Upgrade-Link` metadata.
- Figma does not expose a requests-remaining counter.
- **Superseded:** an earlier note here claimed the budget was per ACCOUNT. It
  is per FILE-plan; see the section above for the measurement that settles it.
- An exhausted Starter file blocks every case that reads THAT file, not the
  corpus. `--offline` replays from the cache so converter work is never gated on
  it, and the clipboard/`.fig` harnesses need no quota at all.
- Render cost scales with the number of ids in an `/images` request, so a
  21-id batch is charged as 21. Batch small and pace; retrying after the fact is
  not enough.
- Clipboard paste and `.fig` upload are zero-quota local alternatives.

## Safety and scale limits

- REST responses are capped at 4 MB. Multi-selection requests split
  recursively; one frame that exceeds the cap fails with "import a smaller
  selection" rather than truncating.
- Node trees are capped at 75,000 nodes and 256 levels before recursive
  rendering. Cycles are rejected.
- Fallback/image-fill references are capped at 256, fetched/uploaded with a
  concurrency of four, limited to 15 MB per image and 64 MB total, and checked
  by MIME signature.
- Figma render/image URLs are fetched through the SSRF-safe path, then mirrored
  into user-scoped durable file storage. Expiring provider URLs and binary data
  are not stored in SQL.
- A required fallback or image fill that Figma fails to return aborts the import.
  The importer never reports success after silently deleting visible content.
- **`/images` clamps a render to 16384px on its longest edge and scales the
  whole node down to fit — no error, no header, no warning.** A 1440x21306
  frame comes back as 1108x16384. Anything comparing that against a full-size
  render is measuring the downscale: it read Landify as a 24.4% converter
  defect when the real number is 6.8%. Ask `/images` for the scale it would
  have forced (`scale=16384/longestEdge`) and render your own side at the same
  factor, so the reference and the candidate are the same pixels.
- Metadata attributes are capped at 16 KB per property; oversized metadata is
  omitted and reported as an approximation.

## Golden corpus required for release confidence

Generated unit fixtures protect parsing and failure behavior but cannot prove
pixel parity. Maintain a permission-safe private test file/corpus with these
real cases and compare both screenshots and editable structure:

1. Nested horizontal, vertical, wrapping, negative-gap, grid, absolute-child,
   min/max, baseline, and responsive auto layout.
2. Mixed fonts/scripts/emoji, missing and custom fonts, variable fonts, lists,
   OpenType features, text-on-path, truncation, and mixed hyperlinks.
3. Every gradient, fill stack, image crop/filter/tile, stroke alignment/dash,
   effect, blend mode, mask type, vector network, boolean op, and arc.
4. Local/remote components, nested instances, variants, exposed properties,
   overrides, swaps, variables/modes/aliases, and published libraries.
5. Prototype overlays, scroll behaviors, links, interactive components, media,
   and conditional actions, verifying they stay inert while editing.
6. Rotated/skewed/flipped nested frames and clipping at fractional coordinates.
7. Single/multi/cross-page clipboard selections, 100+ node selections, revoked
   tokens, inaccessible files, branches, rate limits, null renders, and expired
   image URLs.
8. Small through near-limit documents, deeply nested documents, 32-megapixel
   fallback boundaries, many images, slow storage, cancellation, and retries.
9. Round trips through live-DOM SVG, server SVG, clipboard paste into Figma,
   official MCP native write, PDF export, and re-import with a structural diff.

Release evidence should record the Figma file version, browser/app version,
font environment, screenshot diff thresholds, structural assertions, timing,
memory, warnings, and every fallback. "The import completed" is not a fidelity
assertion.

## Primary references

- Figma REST file/node/image endpoints:
  <https://developers.figma.com/docs/rest-api/file-endpoints/>
- Figma REST node types and mask/interaction/geometry properties:
  <https://developers.figma.com/docs/rest-api/file-node-types/>
- Figma Variables API requirements:
  <https://developers.figma.com/docs/rest-api/variables/>
- Figma MCP write to canvas and current limitations:
  <https://developers.figma.com/docs/figma-mcp-server/write-to-canvas/>
- Figma MCP code to canvas:
  <https://developers.figma.com/docs/figma-mcp-server/code-to-canvas/>
