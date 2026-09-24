---
name: shader-fills
description: >-
  Code-backed GLSL shader fills and shader effects: authoring WGSL-free,
  WebGL1 GLSL fragment shaders that persist as readable source in the screen
  HTML with uniform knobs in the inspector. Use when the user asks for a
  shader fill or shader effect, sends "Create a custom shader fill." from the
  fill picker, wants an animated/procedural background (waves, noise, mesh
  gradients, caustics, grain, halftone), or wants to edit an existing
  shader's GLSL or uniforms.
---

# Code-Backed Shader Fills & Effects

Shaders in Design are **code, not opaque assets**. Each shader is a GLSL
fragment source + JSON uniforms manifest persisted directly in the screen
HTML, rendered live by a self-contained WebGL runtime that is embedded in the
same HTML — so shaders work in the editor, in shared links, and in exported
standalone files. Users see and edit the GLSL in the Code panel; uniform
knobs appear automatically in the inspector (Fill → Shader paint type, and
Effects → Shader).

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

## Applying a shader (preferred path)

Use the pure helpers + the source-edit actions. From `templates/design/`:

```ts
// script: apply-shader.ts — run with: pnpm exec tsx apply-shader.ts
import { applyShaderToHtml, newShaderId } from "./shared/shader-fills";
import { getGlslShaderPreset } from "./shared/shader-presets";

const preset = getGlslShaderPreset("water-caustics")!;
const result = applyShaderToHtml(currentHtml /* from read-source-file */, {
  nodeId: "hero", // the element's data-agent-native-node-id
  def: {
    id: newShaderId(),
    name: preset.label,
    mode: preset.mode, // "fill" | "effect"
    glsl: preset.glsl,
    uniforms: preset.uniforms,
  },
  fallbackColor: "#06283d", // fills only — static no-JS fallback
});
if (result.errors.length) throw new Error(result.errors.join("; "));
// result.html → write back via apply-source-edit (full-replace) with the
// versionHash you got from read-source-file.
```

Action flow: `read-source-file` → transform → `apply-source-edit`
(`edit: { kind: "full-replace", content }`, pass `expectedVersionHash`).
For a small hand-edit (e.g. tweaking one uniform value in the manifest),
`edit-design` search/replace on the exact block text is also fine.

To remove: `removeShaderFromNode(html, nodeId, mode?)` — clears the
annotation and garbage-collects unreferenced definition blocks.

## Handling "Create a custom shader fill." from the picker

The fill picker's **Create new (AI)** tile prefills this prompt with hidden
context lines (`designId`, `fileId`, `target nodeId`, `mode`). Then:

1. Ask what look they want only if the user gave no description at all.
2. Write ORIGINAL GLSL for the request (do not just re-apply a preset), with
   2–5 well-chosen uniforms exposed as knobs. Name the knobs the way the
   user described the controls.
3. Apply it via the helper flow above, targeting the provided nodeId.
4. Report the shader name, its knobs, and that the GLSL is editable in the
   Code panel.

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

## Preset library

`GLSL_SHADER_PRESETS` in `shared/shader-presets.ts` ships 12 curated
presets — fills: `mesh-gradient`, `glowing-wave`, `water-caustics`,
`fractal-noise`, `clouds`, `nebula`, `moire`, `concentric-rings`,
`pattern-grid`; effects: `film-grain`, `halftone`, `scanlines`. Applying a
preset stamps a fresh copy (new id) into the design; after that it is the
user's code to edit.

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
