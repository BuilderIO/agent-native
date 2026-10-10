# Native effects source architecture

Decision checkpoint: 2026-10-06. This records the source gate, not completion of the shader MVP.

Current implementation update, 2026-10-07: the separate declarative selected-scene path now captures held full-scene GPU pixels and has produced decoded local PNG and 180-frame MP4 artifacts for the owned seven-effect Design, as recorded in [native gate evidence](native-gate-evidence.md). Preview color controls can request Display P3 and HDR; the runtime reports requested and actually configured modes separately, and SDR remains the explicit fallback when HDR configuration is unavailable. PNG/MP4 output remains straight-sRGB SDR. Grain, Halftone, and Frost v3 definitions are prepared as unregistered exact-hash candidates; Halftone/Frost pixel-density behavior at 1× versus 2× has not been browser-verified. The historical capability matrix below describes the earlier source checkpoint, not these later results.

Use a Design-owned source provider and GPU compositor behind the versioned effect contract. Static DOM paint is cached by content/style/size revision; images and videos enter through supported external-image copies; generated and processed native output remains in GPU textures. Each frame reprojects source rectangles and composes the required layer or ordered backdrop. Selected-layer processing replaces the visible source artwork while retaining editable, accessible DOM. An overlay is not a processed source.

## Alternatives and evidence

| Path | Evidence | Decision |
| --- | --- | --- |
| Direct HTMLElement copy with standard WebGPU | The standardized external-image source union contains images, videos, frames, bitmaps, image data and canvases, rather than arbitrary HTMLElement. | Cannot serve as the source boundary. |
| HTML-in-Canvas | The living explainer describes flag-gated Chromium APIs; the Chrome article describes an origin trial. No portable unflagged source capability was established in this task. | Keep behind capability investigation; do not require browser flags for ordinary Design. |
| Whole-document DOM rasterization every animation frame | Native generated/processed outputs would repeatedly cross GPU/CPU boundaries; moving cached content would be recaptured unnecessarily. No acceptance benchmark exists for this approach. | Do not use for live processing. |
| Cached leaf paint plus GPU composition | Actual Design and standalone HTML render the source-gate cases below. Motion reuses image rasters. Complex CSS coverage remains incomplete. | Adopt the provider boundary and expand supported coverage with explicit diagnostics and visual proof. |

Primary references: [WebGPU external-image source contract](https://www.w3.org/TR/webgpu/#dictdef-gpucopyexternalimagesourceinfo), [HTML-in-Canvas explainer](https://github.com/WICG/html-in-canvas), [Chrome origin trial](https://developer.chrome.com/blog/html-in-canvas-origin-trial). Checked 2026-10-06.

An intermediate source capability boundary rejected overlapping fractional-opacity groups and rounded source corners. The subsequent GPU compositor now uses cropped, reusable isolation textures so overlapping descendants receive their shared opacity and rounded overflow clip once. Media content-edge ellipses and supported ancestor padding-edge ellipses are also wired into source composition; selected-target rounded clipping remains in the finish pass. Processed native child output retains its baked own opacity, while a consuming parent applies only ancestor opacity. None of these later paths has a browser GPU acceptance result yet.

## Bounded clip and group composition contract

`shared/native-source-clip-plan.ts` resolves a bounded list of at most eight independently projected elliptical clips per source record. It takes already-normalized outer radii in local CSS border-box coordinates, explicit border and padding insets, a positive axis-aligned x/y scale, and the projected border box. Its padding edge subtracts the adjacent border widths; its content edge additionally subtracts padding. It retains each ancestor shape rather than replacing their intersection with one rectangle. Invalid geometry, rotated/mirrored/skewed projection, excessive depth, and inner curves that cease to be quarter ellipses are typed failures. The [CSS Backgrounds corner shaping and clipping rules](https://www.w3.org/TR/css-backgrounds-3/#corner-clipping) distinguish curved padding-edge overflow from curved content-edge replaced media. [CSS Overflow 3](https://www.w3.org/TR/css-overflow-3/#overflow-properties) specifies that both-axis hidden/scroll/auto clips follow the padding edge, while both-axis `clip` uses `overflow-clip-margin` (default padding box, zero offset); mixed `clip`/`visible` is not rounded. The current runtime supports both-axis hidden and both-axis `clip` with default margin; scroll, auto, mixed axes, and nondefault clip margins retain typed diagnostics. The pure containment tests and generated-runtime guard do not establish browser masking fidelity.

`shared/native-source-composition-tree.ts` plans ordered paint records with root-to-leaf opacity and clip identities. Fractional-opacity and ancestor-clip nodes now render through cropped, reusable transparent premultiplied-linear GPU textures, then apply the shared property once when composited into the parent. Identity-opacity nodes without clips flatten; a processed native layer stays atomic with its own authored opacity already baked. The planner rejects noncontiguous hierarchy, changed group metadata, duplicate leaves, nonfinite geometry, and excessive node/depth counts. Runtime estimates source plus isolation textures against 128 MiB per instance and 384 MiB across the realm. Those are allocation limits, not measured memory use. CSS z-index and positioned paint-order conflicts remain typed unsupported; the tree does not implement a general stacking-context engine. Browser comparison of overlapping alpha and corner pixels is still pending.

The current source subset supports replaced image/video/canvas content-edge quarter ellipses, ancestor overflow padding-edge ellipses under both-axis hidden or default `clip`, and positive axis-aligned translation/scale. Visible media own background, border, outline, or shadow is unsupported. Text mixed with visible box paint inside one overflow-clipped source is unsupported. CSS masks and clip-path, rotation, skew, mirroring, 3D transforms, unsupported overflow combinations, and non-DOM paint order retain typed failures. These boundaries are narrower than full CSS source fidelity.

## Composition clock foundation

`renderAt(time)` advances shader time only. The newer `renderCompositionFrame({ frameIndex, fps, startTimeSeconds?, signal?, timeoutMs?, sourceContract: "declarative-only" })` coordinates declarative authored CSS animation and video time, font readiness, and native RAF/clock for a bounded frame. It returns strict render metadata, not pixels; its return is not a reference to a still-synchronized authored scene. Internally, `withSynchronizedCompositionFrame` can await a consumer while that frame is held, before authored clocks are restored, with abort and quiescence handling. This foundation has focused CPU lifecycle tests, but no pixel readback, transport, encoder, or actual GPU/browser acceptance. A dedicated declarative document containing only runtime-owned scripts and canvases can enter this path. Ordinary Design editor previews contain independent executable editor scripts and report typed `composition-scripted-source` until a trusted quiescence integration exists. This is not a completed still or MP4 export path.

## Observed source gate

The actual Design document `JsMgkRn_bxY29lA_WiI5q`, file `6s1T4PHVWKewsgd_3HN3K`, contained seven WebGPU instances using three distinct definitions. All seven reported ready, WebGPU backend, and no error in the existing Codex side tab. These are functional observations, not frame-budget measurements.

- A rounded Grain Gradient fill and editable text mask rendered through WebGPU. Changing the headline to two lines updated glyph-clipped pixels.
- The image processor produced halftone coverage from the terracotta image. Revision-checked replacement with an owned cyan/orange angular landscape changed the resulting dots and sun contours.
- The processed group contained editable text, an image, and an animated native fill. Editing its text to `Edited` / `live light.` updated both processed lines. The group capture counter changed from 7 to 10 during the edit.
- Live glass refracted moving image, text, and generated content. Moving the receiver 40 CSS pixels changed its overlap and sampled pixels; its width stayed 490.5 pixels. The owned source edit was restored afterward.
- The same exported HTML rendered all seven effects without editor globals or runtime CDN imports. Editing its group to `Standalone` / `live light.` updated processed pixels. A moving image changed x from 1111.90 to 1035.01 while the glass remained at x=1173.99. The image raster count remained 1 and backdrop capture count 29 while rendered frame count advanced 2160 to 2427.

Source edits used the permissioned Design source actions and revision hashes. The standalone artifact embedded the required runtime, versioned definitions, and owned SVG assets. Temporary standalone hosting was stopped after validation. Original checkout and unrelated document content were preserved.

## Capability matrix at this checkpoint

| Capability | Existing Codex browser on this Mac | Other environments |
| --- | --- | --- |
| WebGPU generator, image processor, processed group, live backdrop | Observed in Design and standalone HTML | Safari and Windows unverified |
| Editable multiline system-font text | Observed | Cross-browser shaping unverified |
| SVG image raster fallback | Observed; cached across motion | Other GPU/browser paths unverified |
| Source translation and receiver movement | Observed | Rotation/skew/3D unsupported at checkpoint |
| Inline SVG, complex mixed text/media | Explicit unsupported diagnostics at checkpoint | Pending implementation and proof |
| Custom webfont source | Canvas2D text-flow path implemented after this browser checkpoint; browser appearance unverified | Other font and shaping cases retain typed limits |
| Selected-target rounded corners | GPU finish mask wired after this browser checkpoint; browser result unverified | Other browser paths unverified |
| Rounded own-media source and ancestor overflow clips; overlapping group opacity | GPU source masks and isolation textures wired after this browser checkpoint; browser result unverified | Supported subset and limits above; other browser paths unverified |
| Non-DOM CSS paint order | Typed capability failure after this browser checkpoint | General stacking contexts pending |
| Wide gamut / HDR | Current presentation sRGB SDR | P3/HDR output not validated |
| 60/120 Hz supported workload | Not benchmarked | No performance claim |
| Deterministic still and MP4 composition export | Not implemented or validated | Pending authorized pixel capture and encoding |

The Mac hardware inventory identified Apple M5 integrated graphics and Darwin 25.6. The selected Codex browser build, display refresh, DPR and power mode were not fully recorded at this checkpoint. The later performance report must record those values and full source/composition costs before claiming the acceptance floor.

## Remaining vertical-slice work

Browser-verify the newly wired source masks and isolation tree against overlapping alpha and corner pixels, including cache and budget behavior under motion. Extend the supported CSS and font subset needed by the approved scope, and complete deterministic composition export with encoder/container verification. Expand definitions and presets only after those gates. Typed unsupported diagnostics are truthful boundaries, not substitutes for the approved launch scope.
