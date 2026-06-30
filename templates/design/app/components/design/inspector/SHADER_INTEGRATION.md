# Shader Feature Integration Guide

This guide covers the five seam files that need edits to wire the GPU shader feature
into the design template. Each section gives the exact search string to locate the
right spot plus copy-pasteable code to insert or replace.

Do NOT rely on line numbers — they drift. Use the search strings instead.

## Status: shader fills are user-reachable and applyable

The **Shader Fills** card in `DesignExtensionsPanel.tsx` (inspector slot
`design.editor.inspector`) is the live entry point: open it, **Browse Shaders**,
pick a preset, tune it with `ShaderControls`, and the iframe previews the fill as
a CSS gradient (`preview-shader-fill`). With an element selected on the canvas, the
card's **Apply fill** button persists that fill via the `apply-shader-fill` action.

`apply-shader-fill` is **no longer gated** — it is SAFETY-gated, not Builder-gated:

- It asserts **editor** access on the target design (`accessFilter` read +
  `assertAccess("design", id, "editor")`) before any write.
- It only persists **HTML design-file** sources. localhost / fusion / inline-html
  sources return the preview value and write nothing.
- It writes a single inline-style `background` onto the target node through the
  deterministic HTML editor (`applyVisualEdit`, the same persist path as
  `apply-visual-edit`), reusing the strict CSS-colour allowlist from
  `shared/shader-fill.ts` so `descriptor.colors` can never inject CSS.

Sections (a), (b), (d), and (f) below remain optional ways to surface shaders in
*other* inspector seams (the colour picker fill type, the effects panel, the
artboard WebGL bridge, design-system tokens) and are not required for the
card-based apply path that ships today.

---

## (a) DesignColorPicker.tsx — Add `"shader"` fill type

**File:** `app/components/design/inspector/DesignColorPicker.tsx`

### 1. Extend `DesignFillType`

Search for:

```ts
export type DesignFillType = "solid" | "gradient" | "image";
```

Replace with:

```ts
export type DesignFillType = "solid" | "gradient" | "image" | "shader";
```

### 2. Extend `DesignPaintType`

Search for:

```ts
export type DesignPaintType =
  | "solid"
  | "linear"
  | "radial"
  | "angular"
  | "diamond"
  | "none";
```

Replace with:

```ts
export type DesignPaintType =
  | "solid"
  | "linear"
  | "radial"
  | "angular"
  | "diamond"
  | "none"
  | "shader";
```

### 3. Add `canUseShaders` prop to `DesignColorPickerProps`

Search for:

```ts
canUseGradients?: boolean
```

After that line, add:

```ts
canUseShaders?: boolean
```

### 4. Add shader button to the paint-type button row

Search for:

```tsx
{canUseGradients && (
```

After the closing `)}` of that block, add:

```tsx
{
  canUseShaders && (
    <button
      type="button"
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded transition-colors",
        paintType === "shader"
          ? "bg-white/20 text-white"
          : "text-white/50 hover:text-white",
      )}
      onClick={() => onPaintTypeChange?.("shader")}
      title="Shader"
    >
      <IconSparkles size={14} />
    </button>
  );
}
```

Add the import at the top of the file alongside the existing Tabler icon imports:

```ts
import { IconSparkles } from "@tabler/icons-react";
```

### 5. Render `ShaderControls` when `paintType === "shader"`

Search for the block that renders gradient or color controls based on `paintType`.
It will look something like:

```tsx
{paintType === "gradient" ? (
  // gradient controls
) : (
  // solid color controls
)}
```

Extend it to a three-way branch:

```tsx
{paintType === "shader" ? (
  <ShaderControls
    descriptor={
      (() => {
        try {
          return JSON.parse(value ?? "{}");
        } catch {
          return { preset: "MeshGradient", params: {}, colors: [], speed: 1, frame: 0, fit: "contain" };
        }
      })()
    }
    onChange={(descriptor) => {
      onValueChange?.(JSON.stringify(descriptor));
    }}
  />
) : paintType === "gradient" ? (
  // existing gradient controls
) : (
  // existing solid color controls
)}
```

Add the import near the other local inspector imports:

```ts
import { ShaderControls } from "./ShaderControls";
```

The fill row's `value` field holds the serialized `ShaderDescriptor` JSON when
`type === "shader"`. No schema change is needed — it reuses the existing `value: string`
slot.

---

## (b) EditPanel.tsx — Add `ShaderEffectRow` to `EffectsProperties`

**File:** `app/components/design/inspector/EditPanel.tsx`

### 1. Add imports

Search for the block that imports `ShadowEffectRow` (or the effects-related imports).
Add alongside those:

```ts
import { ShaderEffectRow } from "./inspector/ShaderEffectRow";
import type { ShaderDescriptor } from "../../shared/shader-presets";
```

If `EditPanel.tsx` is itself inside the `inspector/` folder, drop the `inspector/` prefix:

```ts
import { ShaderEffectRow } from "./ShaderEffectRow";
```

### 2. Extend `EffectsProperties` props

Search for the `EffectsProperties` function signature. It will include props like
`shadowLayers` and `blurLayers`. Add:

```ts
shaderLayers?: ShaderDescriptor[];
onShaderLayersChange?: (layers: ShaderDescriptor[]) => void;
```

### 3. Render shader effect rows

Search for:

```tsx
{shadowLayers.map(
```

After the `shadowLayers.map(...)` block and the `blurLayers.map(...)` block
(whichever comes last), add:

```tsx
{
  (shaderLayers ?? []).map((layer, i) => (
    <ShaderEffectRow
      key={layer.id ?? i}
      descriptor={layer}
      onChange={(updated) => {
        const next = [...(shaderLayers ?? [])];
        next[i] = updated;
        onShaderLayersChange?.(next);
      }}
      onRemove={() => {
        const next = (shaderLayers ?? []).filter((_, j) => j !== i);
        onShaderLayersChange?.(next);
      }}
    />
  ));
}
```

### 4. Add "Add Shader" option to the effects dropdown

Search for the "Add effect" button or the dropdown that lets users add shadow/blur.
It will contain strings like `"Drop Shadow"` or `"Add Shadow"`. Add a shader option:

```tsx
<DropdownMenuItem
  onSelect={() => {
    onShaderLayersChange?.([
      ...(shaderLayers ?? []),
      {
        preset: "MeshGradient",
        params: { distortion: 0.8, swirl: 0.1 },
        colors: ["#e0eaff", "#241d9a", "#f75092", "#9f50d3"],
        speed: 1,
        frame: 0,
        fit: "contain",
      },
    ]);
  }}
>
  Shader
</DropdownMenuItem>
```

---

## (c) Register apply-shader and get-shader actions

No registration step is required. The actions directory is auto-discovered by the
framework at startup. Confirm both files exist:

```
templates/design/actions/apply-shader.ts   ✓
templates/design/actions/get-shader.ts     ✓
```

If either is missing, the agent won't have access to shader tools. The `defineAction`
export at the top of each file is all that's needed for automatic discovery.

---

## (d) DesignCanvas.tsx — Alpine/inline artboard shader bridge

**File:** `app/components/design/canvas/DesignCanvas.tsx` (or similar canvas file)

### 1. Locate the bridge scripts injection point

Search for:

```
// === BRIDGE SCRIPTS ===
```

Or search for the injected HTML string that wires up the Alpine bridge. It will
contain `<script` tags being concatenated into a string that gets injected into the
artboard iframe.

### 2. Add the shader mount script

Append the following after the existing bridge scripts (inside the same injected
content string):

```js
const shaderBridgeScript = `
<script type="module">
  import { ShaderMount } from 'https://esm.sh/@paper-design/shaders@0.0.76/dist/index.js';

  function mountShaders() {
    document.querySelectorAll('[data-shader]').forEach(el => {
      if (el.__shaderMounted) return;
      el.__shaderMounted = true;
      try {
        const descriptor = JSON.parse(el.getAttribute('data-shader') || '{}');
        if (!descriptor.preset) return;
        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
        el.style.position = 'relative';
        el.prepend(canvas);
        // ShaderMount takes { canvas, preset, uniforms } — map descriptor.params to uniforms:
        new ShaderMount({
          canvas,
          preset: descriptor.preset,
          uniforms: {
            ...(descriptor.params ?? {}),
            colors: descriptor.colors ?? [],
            speed: descriptor.speed ?? 1,
          },
        });
        console.log('[shader bridge] mounted', descriptor.preset, 'on', el);
      } catch (e) {
        console.warn('[shader bridge] mount failed:', e);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', mountShaders);
  // Re-run on mutations (new elements added dynamically):
  new MutationObserver(mountShaders).observe(document.body, { childList: true, subtree: true });
<\/script>
`;
```

Concatenate `shaderBridgeScript` into the injected HTML alongside the other bridge
scripts. The exact concatenation point depends on how the existing bridge is assembled
— look for where the other `<script>` strings are joined.

### 3. Add vanilla shaders package dependency

The bridge imports from `esm.sh` at runtime, so no local dep is strictly required
for the iframe bridge. However, if you want type-safe access in the canvas component
itself, add:

```bash
pnpm add @paper-design/shaders
```

in the `templates/design/` directory. The package provides both the React components
(already used via `@paper-design/shaders-react`) and the vanilla `ShaderMount` class.

### 4. Ensure artboard elements carry `data-shader`

When the canvas renders an element whose fill type is `"shader"`, it must serialize
the `ShaderDescriptor` onto the DOM element as `data-shader`. Search for the artboard
render path (likely a function that serializes fills to inline styles or HTML
attributes) and add:

```ts
if (fill.type === "shader") {
  attrs["data-shader"] = JSON.stringify(fill.descriptor);
  // Optionally set a placeholder background so the element is visible before mount:
  styles["background"] = fill.descriptor.colors?.[0] ?? "transparent";
}
```

---

## (e) Changelog entry

The shader-fills card is now user-reachable and the apply path persists, so a
user-facing changelog entry is warranted. From the `templates/design/` directory:

```bash
agent-native changelog add "Add GPU shader fills — 8 presets (MeshGradient, GrainGradient, Voronoi, Metaballs, Warp, GodRays, Dithering, PaperTexture) with live preview and one-click apply to the selected element" --type added
```

(The effects-panel surface from section (b) is still optional; scope the changelog
line to what actually ships.)

---

## (f) Design-system token shape (for Phase 6)

The design system `data` blob (returned by the `get-design-system` action) can be
extended to store shader tokens without any migration — `data` is already an untyped
JSON blob.

Search for `update-design-system.ts` and locate the `DesignSystemData` interface (or
wherever the `data` field is typed). Add:

```ts
interface DesignSystemData {
  // ... existing fields (colors, typography, spacing, etc.) ...
  tokens?: {
    shaders?: Array<{
      id: string;
      name: string;
      descriptor: ShaderDescriptor;
    }>;
  };
}
```

Import `ShaderDescriptor` from:

```ts
import type { ShaderDescriptor } from "../shared/shader-presets";
```

(Adjust the relative path based on where `update-design-system.ts` lives relative to
the `shared/` folder — typically `../../shared/shader-presets` from inside `actions/`.)

This shape lets the agent call `update-design-system` to persist named shader presets
as reusable design tokens, and `get-design-system` to retrieve them for display in a
shader token picker.

---

## Integration Checklist

Shipped (card-based preview + apply path):

- [x] `DesignExtensionsPanel.tsx` — Shader Fills card opens `ShaderFillsPanel`
- [x] `DesignExtensionsPanel.tsx` — "Apply fill" persists via `apply-shader-fill`
- [x] `actions/apply-shader-fill.ts` — persists fill as CSS background (editor-gated)
- [x] `actions/preview-shader-fill.ts` — preview-only CSS (unchanged)
- [x] `actions/apply-shader.ts` exists (planning/codegen snippet)
- [x] `actions/get-shader.ts` exists

Optional follow-ups (other inspector seams):

- [ ] `DesignColorPicker.tsx` — `DesignFillType` includes `"shader"`
- [ ] `DesignColorPicker.tsx` — `DesignPaintType` includes `"shader"`
- [ ] `DesignColorPicker.tsx` — shader button renders in paint-type row
- [ ] `DesignColorPicker.tsx` — `ShaderControls` renders when `paintType === "shader"`
- [ ] `EditPanel.tsx` — `ShaderEffectRow` renders in `EffectsProperties`
- [ ] `EditPanel.tsx` — "Add Shader" option in effects dropdown
- [ ] `DesignCanvas.tsx` — shader bridge script injected into artboard
- [ ] `DesignCanvas.tsx` — `data-shader` attribute serialized for shader fills
- [ ] Changelog entry added (see section (e))
