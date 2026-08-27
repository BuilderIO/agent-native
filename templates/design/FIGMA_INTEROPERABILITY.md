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

## The `.fig` path decodes in the browser

A `.fig` used to be uploaded before it could be read, because the decoder used
`Buffer`, `node:zlib` and `node:crypto`. Netlify caps a function request at
about 6 MB and real files run to tens of megabytes, which is why the upload
route chunks at 3 MB — and why a 9 MB file reached a user as "the file was too
large" with a 413 behind it.

The decoder and the kiwi walker are now isomorphic: `Uint8Array` throughout,
byte primitives in `shared/fig-bytes.ts`, `fflate` in place of `zlib` and
`@noble/hashes` in place of `crypto`. Both replacements were checked
byte-identical to the Node originals before the swap, and inflate is STREAMED
rather than one-shot — `fflate`'s one-shot form grows past a pre-sized output
buffer instead of refusing, so a crafted `.fig` could allocate gigabytes before
any check saw it.

`shared/fig-to-frames.ts` holds the conversion, with the two things that
genuinely differ between a server and a browser injected: where an image is
stored, and how a frame's HTML is wrapped into a document. The browser decodes
the file, uploads each embedded image through `upload-image` as its own request,
and saves each frame through `import-design-source` as its own request — so
nothing large crosses the network however big the file was. The server route
stays for the agent, A2A and this harness, and as the fallback when the browser
decode throws.

Measured end to end on a 5.6 MB `.fig` in the running app: one frame decoded,
converted and saved in 13.9 s with zero bytes of the file uploaded. The same
file through the old path returns 413 Payload Too Large.

## Clipboard paste fidelity harness

`pnpm figma-fidelity:paste` covers the third route. A clipboard payload shares
the `.fig` walker but not its input: it is a kiwi buffer holding a node SUBTREE
with no DOCUMENT/CANVAS above it, so it goes through `normalizeClipboardDocument`
first, and it carries NO image bytes — only 20-byte hashes that
`hydrate-figma-paste-images` resolves later once a token is connected.

With `FIGMA_FIDELITY_TOKEN` set the harness resolves those hashes the way the
connected product does, so the number is what a connected user actually gets.
Without one, every image fill renders as an `about:blank` placeholder and the
`noImg` column beside the diff says how many.

Measuring the unhydrated HTML was overstating this path by 3x, and it is worth
saying why that mattered: the Untitled UI landing page read **9.61%** against
Figma with its placeholders in, and **3.03%** once hydrated. Its drift against
the REST import of the same frame fell from 7.62% to **0.76%** — two
independently written walkers landing on the same layout, which is the strongest
evidence available that neither is wrong. A number that says a path is three
times worse than it is sends the next fix at the wrong target.

| case | vs Figma | vs the REST import of the same frame |
| --- | --- | --- |
| paste-untitledui-landing | 3.026% | 0.756% |
| paste-positivus-home | 4.018% | 3.880% |
| paste-dashstack-dashboard | 2.535% | — (REST corpus holds a different frame) |

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

## REST import and export, measured on 26 designs

Every case resolves against a node inside the paid team (see below for how to
get one there), so the REST path measures again instead of failing on
Starter-tier limits.

- `import%` — our HTML against Figma's own render of the same node.
- `−text%` — the same comparison with every TEXT node's box excluded.
- `−text/img%` — also excluding every node carrying an image fill.
- `export%` — the SVG Figma receives, against the same reference.
- `drift%` — what the export hop alone costs.

Measured 2026-08-27:

| case | import% | −text% | −text/img% | export% | drift% |
| --- | --- | --- | --- | --- | --- |
| shapes | 0.543 | 0.543 | 0.543 | 0.292 | 0.313 |
| fills-effects | 0.548 | 0.548 | 0.569 | 1.052 | 0.045 |
| community-dashstack-admin | 0.825 | 0.069 | 0.055 | 0.823 | 0.009 |
| app-untitled-ui-settings | 1.092 | 0.456 | 0.084 | 0.946 | 0.494 |
| community-interior-checkout | 1.362 | 0.218 | 0.220 | 1.859 | 0.692 |
| community-interior-ecommerce | 1.938 | 1.297 | 0.131 | 2.723 | 2.489 |
| community-interior-single-product | 2.092 | 0.686 | 0.193 | 2.759 | 1.710 |
| constraints | 2.277 | 0.110 | 0.110 | 2.498 | 0.425 |
| parity-stress | 2.301 | 0.272 | 0.272 | 2.295 | 0.092 |
| community-interior-product-comparison | 2.419 | 0.312 | 0.207 | 2.945 | 0.667 |
| community-positivus-landing | 2.467 | 0.810 | 0.657 | 3.415 | 1.576 |
| community-untitled-ui-landing-alt | 2.500 | 0.917 | 0.266 | 2.381 | 0.897 |
| community-untitled-ui-landing | 2.512 | 0.518 | 0.072 | 2.617 | 0.624 |
| autolayout | 2.632 | 0.410 | 0.410 | 2.395 | 0.281 |
| community-untitled-ui-pricing | 2.672 | 0.245 | 0.190 | 2.633 | 0.166 |
| app-untitled-ui-dashboard-tall | 2.681 | 1.311 | 1.111 | 2.849 | 1.006 |
| community-whitepace-saas | 2.962 | 0.875 | 0.842 | 2.525 | 0.933 |
| card-grid | 3.097 | 0.060 | 0.060 | 3.097 | 0.000 |
| app-untitled-ui-data-table | 3.411 | 0.732 | 0.716 | 3.878 | 0.825 |
| community-landify-example | 3.467 | 1.563 | 0.589 | 3.306 | 1.208 |
| app-untitled-ui-settings-mobile | 3.524 | 0.431 | 0.404 | 3.378 | 0.771 |
| app-untitled-ui-dashboard | 3.679 | 1.294 | 1.027 | 4.011 | 1.042 |
| ds-untitled-ui-table-variants | 3.689 | 1.229 | 0.952 | 2.747 | 2.392 |
| community-landify-tablet | 4.709 | 2.190 | 0.718 | 4.505 | 1.546 |
| community-untitled-ui-landing-mobile | 6.185 | 1.310 | 0.606 | 6.282 | 1.148 |
| typography | 12.597 | 0.005 | 0.005 | 12.594 | 0.192 |
| **mean** | **3.01** | **0.71** | **0.42** | | **0.81** |

Read the last three columns together, because they say what is actually wrong:

- **The export hop is nearly free.** Mean drift 0.81% and max 2.49% across the
  round-trip corpus, which also covers the two clipboard cases. Whatever the
  import hop gets right survives the trip back to Figma.
- **Most of the import number is glyph rasterisation.** Excluding text boxes
  the mean falls to 0.71%, and `typography` — the fixture built to stress text
  — falls to **0.005%**. Nothing but glyphs is wrong on it.
- **Most of what remains is photo resampling.** Excluding image fills too, the
  mean falls to **0.42%**, and the photo-heavy interior storefront — 1.94%
  overall — is **0.13%**.

## Where the remaining pixels actually are

Every differing pixel was classified by whether Figma's OWN render already
varies across that pixel's neighbourhood. A pixel on a glyph or shape EDGE is
two rasterisers disagreeing about partial coverage of the same outline; a pixel
in a FLAT interior is something genuinely in the wrong place or the wrong
colour.

| case | differing | on an edge | flat interior |
| --- | --- | --- | --- |
| typography | 12.60% | 12.47% (**99.0%** of them) | 0.13% |
| untitled UI pricing | 2.67% | 2.55% (95.5%) | 0.12% |
| untitled UI dashboard | 3.68% | 3.47% (94.3%) | 0.21% |
| whitepace | 2.95% | 2.52% (85.5%) | 0.43% |

**This ratio is the sharpest instrument in this document.** Every case that has
stood out on it has turned out to be a real defect the raw percentage had
buried:

- **Interior single product, 36.4% flat interior** against a corpus norm under
  5%. Figma's `/images` does not always return a PNG whose aspect matches the
  `absoluteRenderBounds` it reports for the same node, and 9 of that page's 28
  fallbacks were being stretched to fit — one by 77%. 3.35% -> 2.09%, and its
  flat interior fell to 0.17%.
- **DashStack, 23.6%.** A hugging text node outside auto-layout is emitted at
  Figma's own resolved width, so a string whose advance runs a hair wider wraps
  inside a box built to fit it on one line. 1.08% -> 0.98%.

- **Parity stress, 10.4%.** `strokeGeometry` is the stroke Figma has already
  outlined, but that outline is not clipped to the alignment Figma states, and
  a mitred corner reaches a long way. A 5px INSIDE stroke on a star ran 16px
  past its top point. 2.47% -> 2.30%, flat interior 0.257% -> 0.121%.
- **Run on the `.fig` path for the first time it read 4-5x the REST path's on
  the same designs**, which is what a path-specific defect looks like. Kiwi
  states per-side stroke weights with `borderStrokeWeightsIndependent` and
  writes only the sides that are set; this walker read the REST-shaped names,
  which a raw kiwi node never carries, and fell back to the uniform weight on
  all four sides — a vertical rule between every column of a table that has
  none. Dashboard 4.95% -> 4.33%, flat interior 0.964% -> 0.452%.

### The export's text is rasterisation, not displacement

Running the offline export harness against its stored ceilings — which this
branch had not done since the ceilings were written — `typography` measures
**3.031%** against a 2.014% ceiling. It is not any of this branch's changes:
none of them touch text emission, `origin/main` never touched the export path or
this fixture.

At 6x in a side-by-side the exported text LOOKS about a pixel low, and that read
was wrong. Measured instead of eyeballed, the ink is in exactly the same place:

| band | design ink rows | export ink rows | design ink cols | export ink cols |
| --- | --- | --- | --- | --- |
| heading | 150..200 | 150..200 | 57..256 | 57..256 |
| paragraph | 1016..1035 | 1016..1035 | 214..678 | 214..678 |

Same rows, same columns, same wrap, to the pixel. The classifier then settles
what the 3% is: **100.0% of the differing pixels sit on a glyph edge, 0.000% in
a flat interior.** Every one. This is the same accepted class as the Figma font
difference — two text rasterisers disagreeing about partial coverage of the same
outline, here Chromium's DOM text path against its own SVG `<text>` path — and
not a defect the converter can fix.

The ceiling is set to the measured 3.05% so the harness states that rather than
failing on a number nobody had looked at. Recorded at length because the
side-by-side reading was wrong and the measurement disagreed with it: a
composite of two crops is not evidence about position.

### Export follow-ups, each waiting on a measurement

Raised in review on this branch. None is blind-fixed, because the export hop has
already punished three changes on this branch that looked correct in isolation.

- ~~**`background-size` is discarded on export.**~~ **Fixed.** Every `url()`
  background layer was recorded as `fit: "cover"`, and Figma's four scale modes
  reach the DOM only through `background-size`: FILL is `cover`, FIT is
  `contain`, STRETCH is `100% 100%`, and a CROP is an explicit pixel size with
  an offset. Three of the four were being cropped like the first. Each layer now
  takes its own size, and a CROP is placed exactly with a `userSpaceOnUse`
  pattern rather than approximated — Positivus **3.415% -> 2.871%**, Untitled UI
  mobile 6.577% -> 6.310%, export mean **3.082% -> 3.053%**. `TILE` still tiles
  at the browser's intrinsic size, which SVG cannot ask for, and keeps its note.
- ~~**Skew and non-uniform scale are dropped on export.**~~ **Fixed**, after
  three failed attempts, by a piece the mirror work turned up. It takes four
  things together and every earlier attempt was missing at least one:

  1. **Carry the matrix.** Decompose as `R(theta) . M` and apply M after the
     rotation.
  2. **Reconstruct the rect from the origin.** `centre +/- size/2` assumes a
     transform preserves the centre, which is false for `transform-origin: 0 0`.
     The untransformed top-left is recoverable: the corners map to
     `L + O + t + A . (corner - O)`.
  3. **Leave rasterized nodes alone.** A rasterized node is a SCREENSHOT of its
     region, so the transform is already in its pixels. The importer's
     angular-gradient overlay is exactly this — a conic gradient has no SVG
     equivalent, so it rasterizes — and re-applying the scale squashed it into a
     strip, 1.052% -> 7.49% on the fills fixture.
  4. **Un-transform the CHILDREN.** The renderer wraps them in the node's
     transform too, so they must be measured with it undone or every child is
     transformed twice. This is the one that had been missing, and it only
     surfaced because the mirror fix failed the same way first.

  `effects-transforms` **1.810% -> 1.530%**, the skewed box is a parallelogram
  again, and the corpus does not move: export mean 3.045% -> **3.044%** with no
  case shifting more than 0.02pp. The ceiling comes back down to 1.56%.

- ~~**Nested rotation composition order.**~~ **Measured, not a defect.** The
  concern was that `composeAffine(rotationAbout(...), toLocal)` composes two
  operations that do not commute. Both orders were measured on the new nested
  fixture and score **identically at 1.810%**, and the rotated child lands on
  the same pixels either way (x 68..224, y 719..814 in both renders): the
  rotation and its centre are both in the node's own local space, and a rigid
  ancestor commutes with it. The two orders only diverge once an ancestor scales
  or skews — which is the item above, and the reason to fix that one first.

### The export hop carries twice the structural error

The flat-interior classifier had only ever been pointed at four designs, and
only ever at the IMPORT. Run across all 26 on both hops, the aggregate says
something the diff percentages do not: **import flat interior averages
0.127%, export 0.256%**. The export hop roughly doubles the part of the
difference that is not two rasterisers disagreeing about a glyph edge.

Where they diverge most:

| case | import flat% | export flat% | delta |
| --- | --- | --- | --- |
| community-positivus-landing | 0.013 | 0.700 | +0.687 |
| fills-effects | 0.176 | 0.674 | +0.498 |
| community-interior-product-comparison | 0.200 | 0.677 | +0.477 |
| community-interior-checkout | 0.059 | 0.534 | +0.475 |
| community-untitled-ui-landing-mobile | 0.192 | 0.598 | +0.406 |
| community-interior-single-product | 0.174 | 0.551 | +0.377 |
| community-interior-ecommerce | 0.115 | 0.425 | +0.310 |
| community-landify-tablet | 0.415 | 0.500 | +0.085 |
| app-untitled-ui-data-table | 0.001 | 0.076 | +0.075 |
| community-landify-example | 0.390 | 0.443 | +0.053 |

Read the ranking by ABSOLUTE flat interior, never by its share of the diff.
`fills-effects` shows 64.9% of its differing pixels in flat interiors and looks
alarming, but it is a text-light fixture: the share is high because there are
almost no glyph edges in the denominator, and the absolute figure is 0.674% of
a 420x540 canvas. Ranking by share sends the next hour at the wrong design.

The largest export-only clusters trace to the `objectBoundingBox` pattern that
carries a `background-image` fill, which the export already records as
approximated -- the checkout and product-comparison headers share one photo and
show the identical cluster, 3093 and 2363 pixels in the same two cells. On that
photo the import sits 1.9 grey levels from Figma and the export 7.5.

### A per-side stroke Figma centres on the edge

A Figma stroke does not take space from the layer, and `strokeAlign` decides
which side of the edge it sits on. A CSS `border` does neither: it is always
inside the border box, and it eats into the content box, pushing every child.

The Interior storefront's footer is `Rectangle 19`, a 1px TOP-ONLY stroke at
`strokeAlign: CENTER`. Figma's own `strokeGeometry` for it reads
`M0 0 L0 0.5 L1440 0.5 L1440 0 L1440 -0.5 L0 -0.5 L0 0Z` — y -0.5 to +0.5,
straddling the edge — so Figma covers half of each adjacent row and renders
both at grey **233**. The border rendered one whole row at **212** and left the
other at 255: the same ink, in the wrong place. That divider repeats across four
designs in the corpus, and its signature is unmistakable once the classifier
excludes text: cells of exactly 160 pixels marching along one row.

Each side is now one box-shadow band, placed by `strokeAlign`: an `inset` copy
offset INTO the box paints the inside half, and a plain copy offset out of it
paints the outside half, since CSS clips an outer shadow to outside the border
box. Neither moves a child. That footer now renders **234/234** against Figma's
233/233.

Measured over the whole corpus: import **3.023% -> 2.994%**, export **3.165%
-> 3.082%**. Eight designs improve on each hop and none regress; the export
gains most, because a border that ate the content box was displacing children
in the exported scene too — Untitled UI's dashboard 4.011 -> 3.250, its data
table 3.878 -> 3.286.

### A shadow Figma draws behind the layer

Figma casts a drop shadow from what a layer PAINTS, and `showShadowBehindNode`
says it is not knocked out from under the layer's own bounds. CSS `box-shadow`
does neither: it casts from the border box and is always clipped to OUTSIDE it.

Landify's phone mockup is a frame with no fill whose whole silhouette is a
transparent bezel PNG. Sampled at its rounded corners -- inside the node's box
but outside what it paints -- Figma renders the shadow at grey 224 and ours
rendered **255, nothing at all**. That is the largest concentrated
flat-interior cluster in the corpus, 2247 pixels in one 80x80 cell against a
norm under 600, and at 3x the phone's bottom reads as a hard white block against
Figma's rounded edge.

Such a layer now takes `filter: drop-shadow()`, which casts from the composited
alpha and is not knocked out. Only such a layer: a filled one hides the
difference, and `box-shadow` carries a spread that `drop-shadow()` cannot.

The spread is the reason this took three attempts. `drop-shadow()` has no
spread parameter, and the SVG export needs one -- `feMorphology` can erode an
alpha where CSS cannot. Folding the spread into the blur renders correctly but
loses it on the way out, and the export paid more than the import gained every
time (5.54% at best against a 4.51% baseline). The importer now also writes the
untouched shadow to a `--figma-content-shadow` custom property in `box-shadow`
syntax, so the exporter parses it with the same parser it uses for the real
property and gets offset, blur, spread and colour back losslessly. It then
paints the shadow from the subtree's own alpha: `feMorphology` for spread,
`feFlood` + `feComposite in=SourceAlpha` for the tint, `feGaussianBlur` for the
blur, on a duplicate of the subtree behind the real one -- the same bargain the
box shadow already makes, with the shape corrected.

Measured over the whole corpus: import **3.043% -> 3.023%**, export **3.163% ->
3.165%**. Three designs improve on import (Landify tablet 4.709 -> 4.368,
Landify example 3.467 -> 3.247, Untitled UI mobile 6.185 -> 6.153), 23 are
untouched, none regress; on export one design moves 0.044 and the rest are
unchanged.

Two things measured along the way, recorded so they are not refitted. Our
shadows are NOT globally too weak -- on `fills-effects`, where the shadows sit
over flat ground, ours and Figma's agree within 0-3 grey levels. And an alpha
multiplier does close the phone's remaining gap (x1.35 took an earlier export
build to 4.222%), which is exactly the "shadow blur x1.25 and alpha x1.2"
experiment this file already records as rejected for overfitting this same
mockup. The gap that remains there is the shadow's falloff, not its strength.

### The aggregate is not the only instrument

Two defects were found by looking at a render rather than at a number, and
neither moved the percentage much.

- **Icon fonts imported as hollow boxes.** DashStack's sidebar labels each
  carry a LineAwesome glyph at U+F2C6. A Private Use Area codepoint means
  nothing outside the font that assigned it, and fonts reach an imported screen
  by family name from Google Fonts, which serves no icon font — so Chromium
  drew a `.notdef` box beside all 16 nav items where Figma draws an icon. Such
  a TEXT node now takes the rendered-PNG fallback the walker already uses for
  anything it cannot express. 0.97% -> 0.83%: two tenths of a percent for a
  defect that was the first thing anyone would see. The `.fig` walker has no
  render to fall back on, so it drops the glyph and records the reason against
  the node.
- **A Figma paste into the canvas did nothing at all.** The parent document
  already toasts when a paste plainly came from Figma but carries nothing
  importable. A paste inside the canvas iframe never reaches that listener, and
  the bridge dropped it in silence — so the same paste was explained on the
  shell and invisible on the canvas, which is what a user reported. The bridge
  now relays the clipboard strings for the parent to judge with its own
  `isAttemptedFigmaPaste`, rather than growing a second copy of the rule.

What is left is 0.12% to 0.43% per case. The worst of those cells are the
INSIDES of thick glyph stems, where a half-pixel difference in advance moves
the whole stroke and its interior with it — and, on the two Landify pages, a
drop shadow that Figma paints about 12/255 darker over the same extent. That
one was chased: the blur mapping is already right (rescaling it gains 0.02),
and scaling the shadow's alpha by 1.2 fits those two pages while doing nothing
for DashStack's 38 shadows, which is overfitting to one phone mockup rather
than a mapping error. CSS approximates a Gaussian with box blurs; Figma does
not.

Text position is not the cause. Comparing Figma's `absoluteRenderBounds` — its
own ink box for each text node — against the browser's rendered ink puts them
within 0.4px on ordinary labels, and on the Untitled UI pricing page within
0.003 em with a spread of 0.0004. Our text is where Figma's text is; the pixels
along its edges are covered differently.

## What "pixel perfect" can and cannot mean here, measured

The residual is text, so it is worth saying exactly what the text residual IS
rather than asserting it is irreducible. Four measurements, each of which could
have come out the other way:

| question | method | answer |
| --- | --- | --- |
| Is our text in the wrong PLACE? | search whole- and half-pixel shifts for one that improves the match | **No.** No offset helps on any case; 0,0 is already the best. |
| Do our line BREAKS match Figma's? | compare Figma's height/line-height against the browser's real line boxes | **98.3%** identical (679 of 691). |
| Is it Inter's version? | render the same HTML against Google Fonts and against Inter 3.19 | **No.** 3.19 is worse on 15 of 17 Inter designs. |
| Is it hinting? | render with `text-rendering: geometricPrecision` | **Partly** — worth 0.6pp on `typography`, and now shipped. |

What is left after those is the two rasterisers disagreeing about sub-pixel
coverage on glyph edges, plus a 1.7% tail where a font's Google Fonts variable
instance is a hair wider than the static face Figma uses (Nunito Sans SemiBold
is the case in this corpus). Neither is reachable from the mapping: for an
EDITABLE HTML import the browser lays out and rasterises the text, and it is
not Figma's text engine.

So the honest ceiling for this representation is roughly half a percent of
non-text, non-photo difference — which is where the corpus now sits — and the
number to hold the converter to is the geometry audit below, not the raw pixel
diff. The raw diff should be watched for REGRESSIONS, not driven to zero.

A per-node geometry audit (every node's laid-out box against its own
`absoluteBoundingBox`, accepting `absoluteRenderBounds` where a node paints its
ink, and comparing size alone inside instances, whose boxes Figma reports in
the COMPONENT's coordinate space) is the sharper instrument for the parts the
converter controls, because a 200px layout error is invisible next to glyph
noise.

**23 of 26 designs now have NO node off by more than 1.5px, and the 12
offenders left in the other three all trace to one glyph.** Every one is a hug
box holding a `%`: "40%" hugs to 32.1px against Figma's 30, and the containers
and FILL siblings around it absorb the rest. The 940 hugging text nodes whose
text has no `%` average 0.02px of width error, so what is left in this corpus
is not layout at all — it is one character that the Inter Google Fonts serves
draws wider than the Inter Figma bundles.

What moved the numbers. Each was a real defect on a real design:

| defect | case | before | after |
| --- | --- | --- | --- |
| render clamped at 16384px, compared against a full-size render | landify | 24.38 | 3.94 |
| exported artboard clipped content past the frame | dashboard (export) | 12.05 | 4.23 |
| tiled gradient flattened on export | fills-effects (export) | 13.30 | 1.05 |
| angular gradient swept in pixel space, not normalized space | fills-effects | 12.07 | 0.55 |
| ink extent vs frame box: a 2px shadow shifted every pixel | data table | 10.33 | 3.96 |
| whole-file image map cached by path, so later fills resolved to nothing | untitled UI landing | 9.34 | 2.65 |
| FILL child inside a HUG parent collapsed to zero | landing mobile | 10.65 | 6.43 |
| empty hugging frame collapsed to zero | whitepace | 6.23 | 3.62 |
| SPACE_BETWEEN row also emitting its stale itemSpacing | positivus | 5.45 | 4.74 |
| negative overlap not clamped where the children close up | positivus | 4.74 | 4.23 |
| rotated child taking its pre-rotation width in the row | positivus | 5.76 | 5.45 |
| a mirrored group rendered as a 180-degree rotation | positivus | 5.94 | 5.76 |
| HUG container sized from a cross-axis FILL child's content | positivus | 4.23 | 4.18 |
| kiwi's SPACE_EVENLY unmapped, packing rows left | positivus (paste) | 7.53 | 6.81 |
| zero-thickness vectors dropped by a degenerate viewBox | (arrows, rules) | — | — |
| break characters Figma does not lay out as breaks | whitepace | 3.20 | 2.96 |
| trailing space widening a hugging text box | positivus | 3.05 | 3.03 |
| image-fallback ink taking layout space | settings-mobile | 3.77 | 3.52 |
| hugging text height not rounded the way Figma rounds it | parity-stress | 3.24 | 2.47 |
| an 11.5MB image dropped from the export instead of scaled | single product (export) | 4.69 | 4.02 |
| vector-network mask not scaled out of normalizedSize | positivus (paste) | 6.97 | 6.37 |
| a UNION boolean's operands drawn instead of the union | positivus (paste) | 6.37 | 4.33 |
| counter alignment defaulting to CSS stretch, not Figma's MIN | whitepace (.fig) | 4.94 | 3.39 |
| dashed strokes drawn solid | whitepace (.fig) | 3.39 | 3.37 |
| hugging text ignoring the size Figma resolved | whitepace (.fig) | 3.37 | 3.18 |
| a wrapping auto-layout stack that never wrapped | autolayout (.fig) | 16.79 | 5.20 |
| Figma's own render stretched into a mismatched box | single product | 3.35 | 2.09 |
| a line break Figma did not take | dashstack | 1.08 | 0.98 |
| underline drawn above where Figma draws it | typography | 12.67 | 12.60 |
| an INSIDE stroke drawn outside its shape | parity-stress | 2.47 | 2.30 |
| per-side stroke weights read under REST's names | dashboard (.fig) | 4.95 | 4.33 |
| diamond gradient drawn as an ellipse | fills-effects (.fig) | 17.90 | 15.26 |
| glyphs hinted, not laid out on exact outlines | typography (.fig, vs REST) | 12.49 | 6.55 |
| fill-container overriding the node's own sizing | dashboard (.fig) | 9.26 | 4.95 |
| hugging text 1px tall over, moving every sibling | autolayout (.fig) | 5.15 | 2.38 |
| Figma's text case and decoration dropped | typography (.fig, vs REST) | 6.55 | 6.00 |
| image fill opacity and angular sweep unexpressed | fills-effects (.fig) | 15.26 | 3.72 |
| magnified image fills smoothed, not nearest-sampled | fills-effects (.fig) | 3.72 | 1.46 |
| AUTO line height left to the browser, not Figma's | autolayout (.fig, vs REST) | 2.04 | 0.00 |

Four of those were defects in the HARNESS rather than the converter — it
reported conversion error where the measurement itself was wrong. A fidelity
number is a claim about the converter, so the harness has to be at least as
trustworthy as the thing it grades.

## What each import path's number actually covers

Three paths reach Design, over two independent walkers, and they are not
measured to the same depth. Saying which is which matters more than the
numbers: an unmeasured path looks identical to a passing one in a summary.

| path | walker | measured against Figma | how |
| --- | --- | --- | --- |
| REST node import | `figma-node-to-html.ts` | 26 designs, both hops | `run-import` / `run-roundtrip` |
| Clipboard paste | `fig-file-to-html.ts` | 3 designs | `run-paste`, against the same references |
| `.fig` upload | `fig-file-to-html.ts` | 11 frames | `run-fig`, against the same references |

**`Save local copy` is in the browser's File menu**, not desktop-only as this
document previously claimed — and that wrong belief is the only reason the
`.fig` path went unmeasured for so long. To add a case: open a file whose
frames the REST corpus already imports, `File → Save local copy…`, drop the
result in `.tmp/figma-fidelity/fig-files/` and add it to `fig-corpus.json`.
Frames line up for free, because a `.fig` GUID is `sessionID:localID` — exactly
the shape of a REST node id. Keep each file under the 50MB decoder cap; a whole
multi-design file came to 93MB, while one design each came to 0.9MB, 3.8MB and
46MB.

| case | `.fig` vs Figma | drift vs REST | nodes off >1.5px | REST, same design |
| --- | --- | --- | --- | --- |
| fills and effects | **1.46%** | **0.08%** | **0 of 12** | 0.55% |
| shapes | 1.68% | 1.78% | **0 of 11** | 0.54% |
| constraints | 2.24% | **0.12%** | **0 of 7** | 2.28% |
| interior single product | 2.55% | 1.97% | 1 of 136 | 3.35% |
| auto-layout torture | 2.63% | **0.00%** | **0 of 29** | 2.63% |
| whitepace | 3.08% | 0.60% | 3 of 1026 | 2.96% |
| card grid | 3.14% | **0.29%** | **0 of 11** | 3.10% |
| untitled UI pricing | 3.15% | 0.73% | **0 of 182** | 2.67% |
| untitled UI dashboard | 4.95% | 2.71% | 6 of 201 | 3.68% |
| untitled UI landing mobile | 7.45% | 1.87% | **0 of 228** | 6.19% |
| typography torture | 13.38% | 1.43% | **0 of 9** | 12.67% |

Read the drift column: **two independently written walkers now draw the same
picture.** Auto-layout torture is 0.00% — byte-identical output — and card
grid, constraints and fills/effects are all under 0.3%. That is the strongest
statement available about the `.fig` path, because it says the remaining
difference from Figma is one both walkers share rather than anything this one
does differently.

Nine of the eleven frames have NO node off by more than 1.5px. The dashboard's
six are the same six the REST walker has on that design — all of them the one
glyph — and Whitepace's three are zero-thickness LINE boxes given a minimal
size so the browser does not drop a 0-size SVG viewport.

The image-heavy case is the one to read first: the `.fig` path BEATS the REST
path on it, because **a `.fig` container carries image bytes** where the REST
path re-fetches renders and a clipboard paste carries only hashes. Each of the
three reports zero approximated nodes, so none of these numbers is hiding a
reported hole.

Eight of the eleven frames have NO node off by more than 1.5px. The audit skips
a node id it sees more than once in the render: an inlined symbol child carries
the MASTER's id, and the REST tree's box for that id is the master's position
out on the canvas rather than where any instance draws — comparing those
invented one offender per instance on the card-grid fixture, with sizes that
matched exactly.

The per-node column is the one that moved most, and it is the one to read.
Measuring this path at all found four layout defects the pixel number alone
would never have named — an auto-layout frame's counter alignment defaulting to
CSS `stretch` instead of Figma's MIN, a wrapping stack that never wrapped,
dashed strokes drawn solid, and a hugging text box ignoring the size Figma
resolved. Whitepace went from **93** nodes off by more than 1.5px to 3, and the
auto-layout fixture from 6 to 0 (16.79% to 5.20%). That was only possible
because the walker now emits `data-figma-node-id`; without a node id nothing
could line its output up against Figma's own boxes, and the whole class of
defect was invisible.

Where a case still scores high with ZERO nodes out of place, the difference is
paint, not layout, and the fixtures say which. `fills and effects` is 15.26%
with nothing misplaced, and what is left there is two things, both of which
would need an overlay element rather than a background layer — and **neither of
which any real design in the corpus hits**:

- An IMAGE fill's opacity is dropped, because a CSS background layer carries
  none. Measured across six `.fig` files and three clipboard payloads: one
  occurrence, in the fixture built to catch it.
- An angular gradient is swept in pixel space where Figma sweeps it in the
  node's normalized space. Same measurement: seven angular gradients in real
  designs, **all seven on a square box**, where the two definitions agree
  exactly. The one non-square case is again the fixture.

Both are reported rather than rendered silently wrong, and the counts above are
why they are reported rather than fixed. The diamond gradient WAS fixed — its
L1 falloff is linear inside each quadrant, so four quadrant-tiled linear
gradients are the shape Figma draws and they fit the background stack as-is.

`typography torture` is the same story as on the REST path — glyph
rasterisation, with one node out of place.

Adding the synthetic fixtures is what made this legible: each isolates one
Figma feature, so a defect in one names itself instead of hiding in a page.

The dashboard is the one case still carrying real layout error — 25 nodes, in
two groups. A `Main` frame Figma keeps at 1066px is stretched to its 960px
parent, because Figma lets a fill child overflow its container while CSS
`align-self: stretch` pins it; and a table column Figma hugs to 121px hugs to
103px here, because its cells' text is narrower than Figma's. Taking Figma's
stored size as a MINIMUM on every hugging axis — the generalisation of the rule
that works for text — was measured and rejected: it moved the dashboard 0.01pp
and cost Positivus 0.28pp, because kiwi `size` is the STORED size and goes
stale on the descendants of an instance this walker cannot fully resolve.

The 35MB scratch file still earns its place as decode/render coverage over 43
frames with no Figma reference, and the 127MB one still pins that the size cap
refuses loudly rather than truncating.

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
| kiwi's SPACE_EVENLY mapped to space-between | 7.53% | 5.84% |
| LINE nodes drawn, rotated footprints compensated | 6.97% | 5.20% |
| vector-network masks scaled out of normalizedSize | 6.37% | 5.14% |
| UNION booleans drawn from their operands | 4.33% | 3.02% |

Where the three paste cases stand (2026-08-27), against the same references the
REST corpus uses:

| case | paste vs Figma | converter only | REST, same design |
| --- | --- | --- | --- |
| dashstack admin | 3.16% | 2.50% | 1.08% (a different frame) |
| positivus landing | 4.30% | 2.97% | 2.63% |
| untitled UI landing | 9.60% | 2.92% | 2.51% |

Read the middle column against the last one: on both designs where the same
frame is measured over both paths, the clipboard walker is now within 0.5pp of
the REST walker. What separates the two end columns is almost entirely the
images — **a clipboard payload carries image hashes, never image bytes**, so
those boxes render as placeholders and no amount of converter work fills them.
That is the path's real ceiling, and it needs a Figma token to lift.

Figma also flattens a boolean operation's outline only for REST and the `.fig`
container; a paste carries just the operands. A UNION does not need the
flattened outline — filling the operands together is the union region, and
stroking each with the others masked away is its boundary — so those now draw.
SUBTRACT, INTERSECT and EXCLUDE genuinely need computed geometry and are still
reported as omissions naming the two routes that do carry the shape, rather
than guessed at.

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
