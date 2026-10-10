---
name: shader-fills
description: >-
  Native v2 WGSL fills, source-processing layers, live backdrops, and legacy
  GLSL compatibility. Use when creating or editing procedural GPU materials,
  image/text processors, effect stacks, shader controls, or custom shader code.
---

# Native Shader Fills & Effects

## Preferred native v2 path

Use `get-shader` with `format: "native-v2"` to discover the current
versioned built-in definitions and named presets. For a selected Design screen, pass
`source: {kind:"design-file",designId,fileId}` and, if known,
`target:{nodeId}`. The response distinguishes absent manifest, present
manifest, and missing authored target; it returns `versionHash`, instances,
versioned definitions, and bounded `approvedDefinitionHashes`. Request
`definitionId`, `definitionVersion`, and `includeSource:true` for exact WGSL.
Use `format:"legacy"` only to inspect historical descriptors on older screens.

When describing a built-in effect to a user, use its Shader Library display
name. Canonical IDs and pinned source metadata are for action calls and
provenance; do not present those internal names as product labels.

Choose current built-ins from the `native-v2` response rather than from
historical source names or copied IDs. For example, the registered fill
`an-native-gradient-field` version 1 has a `scale` property and the named
preset `an-preset-catalog-gradient-field-1`. After reading the target file's
`versionHash`, apply it with `edit-native-shader` using
`{kind:"apply",nodeId:"hero",placement:"fill",definitionId:"an-native-gradient-field",definitionVersion:1,params:{scale:1}}`,
or use `{kind:"apply-preset",nodeId:"hero",presetId:"an-preset-catalog-gradient-field-1"}`.
The authored node ID is illustrative; use the exact ID returned for the selected
file. Read back the new source version and inspect the mounted preview before
reporting a visible result.

Use `validate-native-shader` for CPU schema, parameter, and pass-graph checks.
This does **not** compile WGSL or prove GPU rendering. Apply or edit with
`edit-native-shader` and the exact `expectedVersionHash` from the read. Its
discriminated `operation` supports `apply`, `apply-many`, `apply-preset`,
`set-params`, `set-params-many`, `set-instance`, `playback`, `reset-instance`,
`duplicate`, `reorder`, `remove`, `save-preset`, `remove-preset`, and
`revise-definition`. Inspect the action schema for fields; stale source is a
typed conflict. Edits preserve the authored HTML source, editable text, node
IDs, and effect definitions pinned by `(id,version)`.

`apply-many` applies one definition to 2–32 distinct authored `nodeIds` in one
source edit. Pass either one shared `sourceSizing` or `sourceSizingByNodeId`,
never both. The per-node map must have exactly the full set of target node IDs,
with one valid sizing value for each; missing or extra keys fail the whole edit.
`set-params-many` edits 2–32 distinct existing `instanceIds` only when all
refer to the same definition version. A failed target or parameter validation
leaves the original source intact. `apply` and `apply-many` may set an optional
`timing: {speed,paused,time}` with finite nonnegative speed and time. A named
`apply-preset` automatically forwards the preset's saved timing, if present;
its operation has no timing override. Use `playback` for subsequent clock
changes.

The canonical manifest is a JSON script with type
`application/x-agent-native-effects`, `schemaVersion:2`, and separate
`definitions`, `instances`, and optional named `presets`. The pure model lives
in `shared/native-effects.ts`, the pass planner in `shared/effect-graph.ts`,
and the registered built-ins in `shared/native-effect-presets.ts`. Instances bind
to exactly one `data-agent-native-node-id` in authored HTML. An instance
selects `placement:fill|layer|backdrop`, parameters, clipping, timing, and
stack order. `fill` generates content behind text, `layer` processes the
node's own image/text/group source, and `backdrop` samples live content
behind the receiver. For image, text, and group processing, use the native
source path rather than a GLSL overlay.

Each definition has typed properties and one or more WGSL passes. A generator
can write a color texture with no source reads; a processor reads `source`
and writes a different resource; a multipass processor declares resources,
reads prior outputs in an acyclic graph, and names its final `output`.
The runtime supports bounded compute/buffer state for Particle Flow, previous-
frame resources, two named sampled texture inputs, asset-valued texture
parameters, and instance transforms. These are typed contracts, not blanket
CSS or WGSL support: undeclared inputs, unsupported graph/resource modes,
authored-node bindings, arbitrary URL protocols, and unsupported source
composition fail with explicit diagnostics. A two-input render pass maps its
ordered `reads` to WGSL sampled texture bindings 2 and 3; bindings 0 and 1
remain `Globals` and sampler. For a native asset input, store a same-origin
root-relative raster URL in the manifest, never a `data:` or `blob:` URL. For a user-selected native texture, call `upload-design-native-texture` with the selected Design and HTML file IDs, the PNG/JPEG/WebP data URL, and a stable idempotency key for retries. The action verifies editor access and provider bytes and returns a Design-scoped `/api/design-native-texture/<id>.<ext>` path. Store only that returned path in the texture property. The binary reader rechecks current Design access and byte digest; standalone export embeds the same verified bytes. The existing selected Design/file application state identifies the UI target, but the action requires both IDs explicitly. Do not reuse the QA-local uploader or paste a hosted CDN URL into a native texture property.
Standalone export packages referenced local raster bytes in a bounded inert
registry without changing the authored URL or definition hash. The runtime
checks the registry digest before decode; missing, unreadable, or oversized
inputs fail explicitly. A registered local QA upload URL is resolved only by
its scoped export provider, not by an arbitrary network fetch. Each render
ordinary render pass uses the fixed `Globals` uniform, sampler, and two sampled
texture bindings (0–3), `vs`/`fs` entry points, linear RGB working color, and
premultiplied output.

A stateless source processor can opt into `statelessCompute: {abi:
"source-buffer-v1",bufferResource,sharedBytes}`. Its graph contains exactly the
external sampled `source`, one nonpersistent buffer with `size: "source"`,
`sourceBytesPerPixel: 1|4|8|16`, storage/copy-destination usage, and one
nonpersistent RGBA16F viewport output. One `cs` compute pass reads source and
writes that buffer; the following `vs`/`fs` resolve reads both. Binding 4 is the
same storage range, writable in compute and read-only in resolve. Dispatch uses
`elements: "source-grid"` with a declared `[x,y,1]` workgroup of at most 256
lanes, or `elements: "source-row-blocks"`, `[64,1,1]`, and an integer
`blockProperty` from 1 to 16. Source dimensions and encoded render density
determine dispatch. Dynamic storage is capped at 16 MiB; shared workgroup bytes
at 16 KiB. Unsupported resource modes and device limits fail explicitly.
Buffers and sampled/result textures stay accounted for until queue completion,
including teardown. This ABI changes the exact executable hash and requires
the same validation and approval workflow as other custom definitions.

Property insertion order fixes vec4 uniform slots; a `color-array` occupies
one count slot plus its bounded colors. `displayScale` changes inspector
presentation only: displayed value/bounds/step are stored values multiplied
by the positive scale, and commits divide by it.

A `position` property has an explicit `basis: "source" | "viewport"` and
accepts an anchor keyword or `{x,y}`. Each axis is a normalized number, an
axis keyword, or `{value,unit:"uv"|"percent"|"px"}`. It occupies one vec4
`[x,y,xUnit,yUnit]` with unit codes 0, 1, 2 for UV, CSS px, and percent.
`nativePositionUv` resolves pixels with the effective render DPR and physical
source or viewport dimensions. The inspector preserves the other axis when
editing one axis; ratio/percent conversion retains the same normalized point.
Choosing pixels reinterprets the displayed numeric value because the control
does not have live source dimensions. `set-params` validates and persists the
same value shape for UI and agent edits.

Imported or user-authored WGSL is executable shader source. The manifest's
`provenance` is metadata, never approval. Bundled exact v1/v2 source hashes
run automatically; other definitions need the editor/user's explicit
`edit-native-shader` `approve-definition` operation with exact
`expectedExecutionHash` after CPU validation. `revoke-definition` removes an
approved hash. Approval lives in user-scoped Design application state, not
the authored HTML. A changed property order, pass, resource, or output changes
the hash and needs reapproval. The runtime reports `definition-untrusted`
and keeps last-good pixels when approval is missing. GPU compilation and
preview are still needed for visual proof; approval and CPU validation make
no guarantee that arbitrary WGSL terminates. Existing authored HTML may also
contain arbitrary JavaScript, which this WGSL approval boundary does not
sandbox.

For a held composition-frame validation, use `request-native-shader-validation`
with the exact selected source version and a case containing
`mountedFrame: {viewport: {width,height},pixelRatio}`. These CSS dimensions
are integers from 1 to 2048 and `pixelRatio` is finite from 1 to 2; the physical
frame is limited to 4096 pixels per side and 4,194,304 pixels total. Its
`timeSeconds` must align to a 60 fps frame from 0 to 2 seconds. The foreground
editor prepares each viewport and ratio separately through
`prepare-native-scene-export`, passing the case's `pixelRatio`; preparation
and held rendering use that same density. Inspect the returned physical pixel
dimensions and validation result before claiming a frame at that density.

For an actual live mounted-scene performance window, call
`request-native-shader-validation` with exactly one case using
`mountedMeasurement:{warmupRafIntervals:120,measuredRafIntervals:840}` and
`timeSeconds:0`, after finding the current editor tab with
`get-native-render-contexts`. This measures the visible playing iframe's
ordinary RAF and render loop, without a seek or pixel readback. The result
contains 840 post-warmup RAF intervals, per-render full-window CPU/source/
compose distributions, deadline counts, capture delta, preview quality and
pixel ratio, texture accounting, and a separately labelled latest sparse GPU
mount sample. Hidden, offscreen, stalled, failed, or changed source windows
return typed failures. One request takes at most 40 seconds inside the
validation action's 45-second running lease. A measured 120 Hz or DPR 2
claim requires the returned effective density and host/browser refresh proof;
requesting the window alone does not establish either condition. Stateful
feedback cases still require a bounded held-frame validation path.

The inspector can preview instance opacity and transform changes during a
scrub without writing source; commit persists one `set-instance` edit and one
history gesture, while cancel or target change clears the preview. Translation
is stored in pixels, scale as factors, rotation in radians, and origin as
normalized coordinates; the inspector presents scale/origin as percentages
and rotation as degrees. The parent sends a bounded same-origin preview tied
to the mounted runtime epoch, definition hash, and persisted instance
signature. A stale reply cannot authorize a write. This live scrub path has
focused tests but still needs a real-browser GPU checkpoint.

Shader Lab drafts are ephemeral and apply only to an already mounted instance.
An editor preview uses the exact parent/iframe window and origin, runtime
epoch, base execution hash, and request generation. Agent-initiated preview
uses `native-shader-draft-foreground`: its bounded WGSL/params payload is a
user-scoped private attachment, while application state holds only an opaque
handle and lease metadata. The editor claims that request in its own tab and
uses the same preview bridge. Neither a draft attachment nor a successful GPU
preview grants exact-hash execution approval or publishes source; Apply still
requires `edit-native-shader` with the expected source version. The inspector's
GPU pass sum is the latest sampled command encoder for the selected mount's
active definition and instance controls, with frame index and pass count.
That encoder includes required source and dependency passes; it is not an
isolated shader cost, full-scene duration, or GPU percentile. Mounted
measurement results bind the target and reject a sample begun before the
measured window. CPU compile/render wall times remain separate, and
pending/unavailable/error states are explicit.

Same-file duplicate and cross-file inline paste preserve a native v2 stack,
its versioned definitions, parameter overrides, timing, seed, transform,
and stack order. The clone path remaps instance IDs, authored target IDs, and
authored-node bindings; it validates the clipboard snapshot and source/fragment
hashes before applying. Imported custom definition approvals do not travel
with the clipboard. Conflicting definitions, ambiguous or missing targets,
external authored-node bindings, changed readable source, runtime-only
insertion, and linked-component source-only clones fail with typed errors.

## Legacy GLSL compatibility

Existing authored GLSL screens remain readable and editable. Their fragment
source and JSON uniforms live in the screen HTML, with a self-contained WebGL
runtime. Historical preset descriptors are inspection-only and cannot be
applied as new shaders through `apply-shader` or `apply-shader-fill`. Use the
native v2 action flow above for new fills and effects.

The canonical format module is `shared/shader-fills.ts`. Always prefer its
helpers over hand-assembling markup.

## Persisted format (v1)

One definition block per shader (place before `</body>`):

```html
<script type="application/x-agent-native-shader"
        data-shader-id="an-shader-x1y2z3ab"
        data-shader-name="Aurora Drift"
        data-shader-mode="fill">
/*! an-shader v1
{
  "uniforms": {
    "u_speed":   { "type": "float", "value": 1, "min": 0, "max": 4, "step": 0.01, "label": "Speed" },
    "u_color_a": { "type": "color", "value": "#4f2d8f", "label": "Base" },
    "u_center":  { "type": "vec2",  "value": [0.5, 0.5], "label": "Center" }
  }
}
*/
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_speed;
uniform vec3 u_color_a;
uniform vec2 u_center;
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  gl_FragColor = vec4(u_color_a * (0.6 + 0.4 * sin(u_time * u_speed + distance(uv, u_center) * 8.0)), 1.0);
}
</script>
```

Element references (both can coexist on one element, like Figma):

```html
<!-- Fill: canvas rendered BEHIND the element's content. Keep a static
     fallback background so the artifact renders without JS/WebGL. -->
<div data-agent-native-node-id="hero"
     data-an-shader-fill="an-shader-x1y2z3ab"
     data-an-shader-uniforms='{"u_speed":2}'
     style="background: #4f2d8f">…</div>

<!-- Effect: transparent overlay canvas ABOVE the content. Per-element
     overrides live in a separate attribute. -->
<div data-an-shader-effect="an-shader-grain001"
     data-an-shader-effect-uniforms='{"u_intensity":0.2}'>…</div>
```

The runtime must be embedded once per document as
`<script data-agent-native-shader-runtime data-runtime-version="1">…` —
`ensureShaderRuntime()` / `applyShaderToHtml()` handle this.

## Editing an existing legacy GLSL shader

For an existing authored GLSL definition, use `shared/shader-fills.ts` to parse
and validate its source and uniforms. Read the exact source version before an
edit and persist through the source-edit action. Preserve its current shader
identity and readable fallback; do not use a historical descriptor to create
a new shader. A request for a new custom material uses the native v2 manifest,
CPU validation, exact-hash approval where needed, and the editor GPU preview.

## GLSL rules (WebGL1 / GLSL ES 1.00)

- Start with `precision highp float;`. Write to `gl_FragColor`.
- Declare `uniform vec2 u_resolution;` and `uniform float u_time;` when used
  — the runtime drives them automatically (`u_time` is seconds; it stays 0
  under `prefers-reduced-motion`). Never put builtins in the manifest.
- Every manifest uniform MUST be declared in the GLSL with the mapped type:
  `float` → `uniform float`, `vec2` → `uniform vec2`, `color` → `uniform
  vec3` (colors arrive normalized 0–1 RGB). Validation rejects unused knobs.
- Uniform names match `u_[A-Za-z0-9_]+`; ≤ 16 uniforms; float knobs need
  `min`/`max`/`step`; color values are `#rrggbb` hex.
- Loop bounds must be compile-time constant (`for (int i = 0; i < 5; i++)`).
- Effects are composited over content: output premultiplication is off, so
  `gl_FragColor = vec4(color, alpha)` with alpha < 1 overlays cleanly.
- Never include `</script`, `<script`, or `*/`-breaking sequences in GLSL,
  names, or labels — `validateShaderDef()` enforces this; run it (or
  `applyShaderToHtml`, which calls it) before writing.

## Historical shader descriptors

`shared/shader-presets.ts` retains eight descriptor identifiers for saved
screens. They are compatibility data, not current choices. `get-shader` with
`format:"legacy"` reports read-only status and inspection instructions without
advertising the retired presets. Existing authored GLSL definitions remain
readable; use the native catalog for new applications.

## Fills vs effects

| | Fill (`data-an-shader-fill`) | Effect (`data-an-shader-effect`) |
|---|---|---|
| Canvas position | Behind content (negative z-index in an isolated stacking context, above the element's own background) | Overlay above content, `pointer-events: none` |
| Output | Opaque pixels (a material) | Transparent overlay (alpha compositing) |
| Fallback | Element keeps a static `background` color | Degrades to no overlay |
| Overrides attr | `data-an-shader-uniforms` | `data-an-shader-effect-uniforms` |

Failures (no WebGL, compile error, > 8 mounts per screen) remove the canvas
and record the reason in `data-an-shader-error` on the element — check that
attribute when a shader "isn't showing".
