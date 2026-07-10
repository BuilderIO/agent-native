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

| Workflow or feature          | Current behavior                                                                                                                                                                                                   | Fidelity                                                                                                                                                         | Required verification                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Figma frame URL / file key   | Reads the exact node through `file_content:read`, converts it to a new Design screen, mirrors expiring images into durable storage, and returns a per-node fidelity report.                                        | Mixed; see node matrix below.                                                                                                                                    | REST fixture, authenticated file, screenshot comparison.                                            |
| Figma URL without a node id  | Imports the first top-level object on the first page. A specific frame URL is recommended for deterministic results.                                                                                               | Same as node import.                                                                                                                                             | Multi-page and empty-page fixtures.                                                                 |
| Figma branch URL             | Uses the branch key and imports that branch's node.                                                                                                                                                                | Same as node import.                                                                                                                                             | Main/branch pair with divergent content.                                                            |
| Figma clipboard to Design    | Uses private `figmeta.selectedNodeData` ids when present, then the same REST converter. Older visible HTML is only a fallback. Binary-only clipboard data without ids/token is not decoded.                        | Exact selection identity while Figma's private metadata shape remains compatible; node fidelity is mixed.                                                        | Real Chrome copy from single, multi, nested, and 100+ node selections.                              |
| `.fig` upload                | Bounded best-effort decoding of known Kiwi/ZIP variants into editable HTML. Embedded images are moved to durable storage.                                                                                          | Experimental. The format is proprietary and has no compatibility guarantee.                                                                                      | Corpus of real files from multiple Figma versions; never only generated containers.                 |
| Design to Figma clipboard    | Copies an SVG built from the live rendered DOM. Figma imports supported SVG primitives as editable layers.                                                                                                         | Visual/vector handoff, not a native semantic round trip. Auto layout, variables, components, prototypes, HTML state, and code identity are not recreated by SVG. | Paste into real Figma and inspect layer types, text, images, effects, clipping, and bounds.         |
| Design SVG download          | Same conversion as clipboard, with a server-render fallback when a live DOM is unavailable.                                                                                                                        | Same SVG limits; the export report lists approximations and omissions.                                                                                           | Live and server paths, selected layer and whole screen.                                             |
| Native Design to Figma write | Use Figma's official MCP `use_figma` write-to-canvas path when the connected client/account supports it.                                                                                                           | Native Figma structures, subject to Figma MCP beta limitations and permissions.                                                                                  | Full-seat/edit-permission account and a real destination file.                                      |
| `.fig` download              | Not supported. There is no documented public `.fig` authoring contract.                                                                                                                                            | Unsupported.                                                                                                                                                     | Do not label SVG/ZIP as `.fig`.                                                                     |
| Open-ended Figma chat        | Provider catalog/docs/request expose the REST surface allowed by the user's scoped token; non-read calls require approval. Native canvas authoring requires official Figma MCP, not a personal access token alone. | Endpoint-dependent.                                                                                                                                              | Read scopes, expired/revoked token, rate limiting, Enterprise-variable permissions, MCP connection. |

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
