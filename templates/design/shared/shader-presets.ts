/**
 * Single source of truth for the shader preset catalogs:
 *
 * 1. The 8 curated GPU presets backed by @paper-design/shaders-react
 *    (legacy CSS-approximation persist path — `SHADER_PRESETS`).
 * 2. The code-backed GLSL preset library (`GLSL_SHADER_PRESETS`, bottom of
 *    this file) — full fragment sources + uniform manifests persisted
 *    verbatim into screen HTML per shared/shader-fills.ts, readable and
 *    editable in the Code panel. This is the library behind the "Shader"
 *    paint type's Presets section and the Shader effect entry.
 *
 * This file intentionally does NOT import @paper-design/shaders-react (and
 * imports only types from shader-fills.ts) so it remains SSR-safe and can be
 * imported in Vitest without a DOM. All legacy param metadata is inlined from
 * the package defaults (v0.0.76).
 */

import type { GlslShaderMode, GlslUniformManifest } from "./shader-fills";

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type ParamKind = "number" | "color" | "enum" | "bool" | "colors";

export interface ParamDef {
  key: string;
  kind: ParamKind;
  label: string;
  default: number | boolean | string | string[];
  /** Inclusive minimum — only for kind "number" */
  min?: number;
  /** Inclusive maximum — only for kind "number" */
  max?: number;
  /** Slider step — only for kind "number" */
  step?: number;
  /** Allowed values — only for kind "enum" */
  options?: string[];
  /** Maximum array length — only for kind "colors" */
  maxCount?: number;
  /**
   * True when updating this param triggers a full shader recompile.
   * Show a warning in the UI for grainMixer / grainOverlay.
   */
  isExpensive?: boolean;
}

export type ShaderPresetName =
  | "MeshGradient"
  | "GrainGradient"
  | "Voronoi"
  | "Metaballs"
  | "Warp"
  | "GodRays"
  | "Dithering"
  | "PaperTexture";

/**
 * The serialisable descriptor stored on a layer / design token.
 * Universal sizing params (fit, scale, rotation, offsetX, offsetY) live here
 * at the top level; shader-specific params live in `params`.
 */
export interface ShaderDescriptor {
  preset: ShaderPresetName;
  /** Shader-specific numeric / enum / bool params (not colors, not universal sizing). */
  params: Record<string, number | boolean | string>;
  /** Color array for shaders that accept a variable-length palette. */
  colors?: string[];
  speed?: number;
  frame?: number;
  fit?: "none" | "contain" | "cover";
  scale?: number;
  rotation?: number;
  offsetX?: number;
  offsetY?: number;
}

export interface ShaderPresetDef {
  name: ShaderPresetName;
  label: string;
  description: string;
  /** Default value for the `colors[]` array, if the shader accepts one. */
  defaultColors?: string[];
  /** Default value for the `colorBack` single-color param. */
  defaultColorBack?: string;
  /** Default value for the `colorFront` single-color param. */
  defaultColorFront?: string;
  /** Default value for the `colorBloom` single-color param (GodRays). */
  defaultColorBloom?: string;
  /** Default value for the `colorGlow` single-color param (Voronoi). */
  defaultColorGlow?: string;
  /** Default value for the `colorGap` single-color param (Voronoi). */
  defaultColorGap?: string;
  /**
   * Shader-specific param definitions.
   * Does NOT include the universal sizing/animation params
   * (fit, scale, rotation, offsetX, offsetY, originX, originY, speed, frame).
   */
  params: ParamDef[];
  /** Maximum number of entries in the colors[] array. */
  maxColorCount?: number;
  /**
   * True when the shader is intended as a composited overlay effect
   * rather than a standalone background (e.g. Dithering).
   */
  isEffect?: boolean;
}

// ---------------------------------------------------------------------------
// Universal params — shared by every shader
// These are surfaced at the ShaderDescriptor top level, not in params{}.
// ---------------------------------------------------------------------------

export const UNIVERSAL_PARAMS: ParamDef[] = [
  {
    key: "fit",
    kind: "enum",
    label: "Fit",
    default: "contain",
    options: ["none", "contain", "cover"],
  },
  {
    key: "scale",
    kind: "number",
    label: "Scale",
    default: 1,
    min: 0.01,
    max: 10,
    step: 0.01,
  },
  {
    key: "rotation",
    kind: "number",
    label: "Rotation (rad)",
    default: 0,
    min: -3.14159,
    max: 3.14159,
    step: 0.01,
  },
  {
    key: "offsetX",
    kind: "number",
    label: "Offset X",
    default: 0,
    min: -1,
    max: 1,
    step: 0.01,
  },
  {
    key: "offsetY",
    kind: "number",
    label: "Offset Y",
    default: 0,
    min: -1,
    max: 1,
    step: 0.01,
  },
  {
    key: "speed",
    kind: "number",
    label: "Speed",
    default: 1,
    min: -5,
    max: 5,
    step: 0.1,
  },
  {
    key: "frame",
    kind: "number",
    label: "Frame",
    default: 0,
    min: 0,
    max: 10000,
    step: 1,
  },
];

// ---------------------------------------------------------------------------
// Preset definitions
// ---------------------------------------------------------------------------

export const SHADER_PRESETS: readonly ShaderPresetDef[] = [
  // -------------------------------------------------------------------------
  // MeshGradient
  // -------------------------------------------------------------------------
  {
    name: "MeshGradient",
    label: "Mesh Gradient",
    description:
      "Smooth flowing gradient mesh with optional film grain overlay.",
    defaultColors: ["#e0eaff", "#241d9a", "#f75092", "#9f50d3"],
    maxColorCount: 10,
    params: [
      {
        key: "distortion",
        kind: "number",
        label: "Distortion",
        default: 0.8,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "swirl",
        kind: "number",
        label: "Swirl",
        default: 0.1,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "grainMixer",
        kind: "number",
        label: "Grain Mixer",
        default: 0,
        min: 0,
        max: 1,
        step: 0.01,
        isExpensive: true,
      },
      {
        key: "grainOverlay",
        kind: "number",
        label: "Grain Overlay",
        default: 0,
        min: 0,
        max: 1,
        step: 0.01,
        isExpensive: true,
      },
    ],
  },

  // -------------------------------------------------------------------------
  // GrainGradient
  // -------------------------------------------------------------------------
  {
    name: "GrainGradient",
    label: "Grain Gradient",
    description: "Noisy gradient with configurable shape and grain intensity.",
    defaultColorBack: "#000000",
    defaultColors: ["#7300ff", "#eba8ff", "#00bfff", "#2a00ff"],
    maxColorCount: 7,
    params: [
      {
        key: "softness",
        kind: "number",
        label: "Softness",
        default: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "intensity",
        kind: "number",
        label: "Intensity",
        default: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "noise",
        kind: "number",
        label: "Noise",
        default: 0.25,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "shape",
        kind: "enum",
        label: "Shape",
        default: "corners",
        options: [
          "corners",
          "radial",
          "wave",
          "dots",
          "truchet",
          "ripple",
          "blob",
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Voronoi
  // -------------------------------------------------------------------------
  {
    name: "Voronoi",
    label: "Voronoi",
    description: "Animated Voronoi cell diagram with glow and gap controls.",
    defaultColors: ["#ff8247", "#ffe53d"],
    defaultColorGlow: "#ffffff",
    defaultColorGap: "#2e0000",
    maxColorCount: 5,
    params: [
      {
        key: "stepsPerColor",
        kind: "number",
        label: "Steps Per Color",
        default: 3,
        min: 1,
        max: 10,
        step: 1,
      },
      {
        key: "colorGlow",
        kind: "color",
        label: "Glow Color",
        default: "#ffffff",
      },
      {
        key: "colorGap",
        kind: "color",
        label: "Gap Color",
        default: "#2e0000",
      },
      {
        key: "distortion",
        kind: "number",
        label: "Distortion",
        default: 0.4,
        min: 0,
        max: 2,
        step: 0.01,
      },
      {
        key: "gap",
        kind: "number",
        label: "Gap",
        default: 0.04,
        min: 0,
        max: 0.2,
        step: 0.001,
      },
      {
        key: "glow",
        kind: "number",
        label: "Glow",
        default: 0,
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Metaballs
  // -------------------------------------------------------------------------
  {
    name: "Metaballs",
    label: "Metaballs",
    description: "Organic blobs that merge and separate over time.",
    defaultColorBack: "#000000",
    defaultColors: ["#6e33cc", "#ff5500", "#ffc105", "#ffc800", "#f585ff"],
    maxColorCount: 8,
    params: [
      {
        key: "count",
        kind: "number",
        label: "Count",
        default: 10,
        min: 1,
        max: 20,
        step: 1,
      },
      {
        key: "size",
        kind: "number",
        label: "Size",
        default: 0.83,
        min: 0.01,
        max: 2,
        step: 0.01,
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Warp
  // -------------------------------------------------------------------------
  {
    name: "Warp",
    label: "Warp",
    description: "Domain-warped gradient with shape-based tiling.",
    defaultColors: ["#121212", "#9470ff", "#121212", "#8838ff"],
    maxColorCount: 10,
    params: [
      {
        key: "proportion",
        kind: "number",
        label: "Proportion",
        default: 0.45,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "softness",
        kind: "number",
        label: "Softness",
        default: 1,
        min: 0,
        max: 2,
        step: 0.01,
      },
      {
        key: "distortion",
        kind: "number",
        label: "Distortion",
        default: 0.25,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "swirl",
        kind: "number",
        label: "Swirl",
        default: 0.8,
        min: 0,
        max: 5,
        step: 0.01,
      },
      {
        key: "swirlIterations",
        kind: "number",
        label: "Swirl Iterations",
        default: 10,
        min: 1,
        max: 20,
        step: 1,
      },
      {
        key: "shapeScale",
        kind: "number",
        label: "Shape Scale",
        default: 0.1,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "shape",
        kind: "enum",
        label: "Shape",
        default: "checks",
        options: ["checks", "cross", "circle", "star", "waves", "spiral"],
      },
    ],
  },

  // -------------------------------------------------------------------------
  // GodRays
  // -------------------------------------------------------------------------
  {
    name: "GodRays",
    label: "God Rays",
    description: "Volumetric light rays emanating from a configurable source.",
    defaultColorBack: "#000000",
    defaultColorBloom: "#0000ff",
    defaultColors: ["#a600ff6e", "#6200fff0", "#ffffff", "#33fff5"],
    maxColorCount: 5,
    params: [
      {
        key: "colorBloom",
        kind: "color",
        label: "Bloom Color",
        default: "#0000ff",
      },
      {
        key: "density",
        kind: "number",
        label: "Density",
        default: 0.3,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "spotty",
        kind: "number",
        label: "Spotty",
        default: 0.3,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "midIntensity",
        kind: "number",
        label: "Mid Intensity",
        default: 0.4,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "midSize",
        kind: "number",
        label: "Mid Size",
        default: 0.2,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "intensity",
        kind: "number",
        label: "Intensity",
        default: 0.8,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "bloom",
        kind: "number",
        label: "Bloom",
        default: 0.4,
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Dithering
  // -------------------------------------------------------------------------
  {
    name: "Dithering",
    label: "Dithering",
    description:
      "Ordered dithering overlay effect. Composites over the layer beneath it.",
    defaultColorBack: "#000000",
    defaultColorFront: "#00b2ff",
    isEffect: true,
    params: [
      {
        key: "colorBack",
        kind: "color",
        label: "Background Color",
        default: "#000000",
      },
      {
        key: "colorFront",
        kind: "color",
        label: "Foreground Color",
        default: "#00b2ff",
      },
      {
        key: "shape",
        kind: "enum",
        label: "Shape",
        default: "sphere",
        options: ["sphere", "ring", "pill", "linear", "diamond"],
      },
      {
        key: "type",
        kind: "enum",
        label: "Dither Type",
        default: "4x4",
        options: [
          "4x4",
          "8x8",
          "2x2",
          "ordered",
          "checker",
          "bluenoise",
          "random",
        ],
      },
      {
        key: "size",
        kind: "number",
        label: "Size",
        default: 2,
        min: 1,
        max: 20,
        step: 1,
      },
    ],
  },

  // -------------------------------------------------------------------------
  // PaperTexture
  // -------------------------------------------------------------------------
  {
    name: "PaperTexture",
    label: "Paper Texture",
    description:
      "Procedural paper surface with grain, fiber, crumples, and folds.",
    defaultColorFront: "#9fadbc",
    defaultColorBack: "#ffffff",
    params: [
      {
        key: "colorFront",
        kind: "color",
        label: "Front Color",
        default: "#9fadbc",
      },
      {
        key: "colorBack",
        kind: "color",
        label: "Back Color",
        default: "#ffffff",
      },
      {
        key: "contrast",
        kind: "number",
        label: "Contrast",
        default: 0.3,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "roughness",
        kind: "number",
        label: "Roughness",
        default: 0.4,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "fiber",
        kind: "number",
        label: "Fiber",
        default: 0.3,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "fiberSize",
        kind: "number",
        label: "Fiber Size",
        default: 0.2,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "crumples",
        kind: "number",
        label: "Crumples",
        default: 0.3,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "crumpleSize",
        kind: "number",
        label: "Crumple Size",
        default: 0.35,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "folds",
        kind: "number",
        label: "Folds",
        default: 0.65,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "foldCount",
        kind: "number",
        label: "Fold Count",
        default: 5,
        min: 1,
        max: 20,
        step: 1,
      },
      {
        key: "fade",
        kind: "number",
        label: "Fade",
        default: 0,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "drops",
        kind: "number",
        label: "Drops",
        default: 0.2,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "seed",
        kind: "number",
        label: "Seed",
        default: 5.8,
        min: 0,
        max: 100,
        step: 0.1,
      },
    ],
  },
] as const;

// ---------------------------------------------------------------------------
// Derived lookups
// ---------------------------------------------------------------------------

export const SHADER_PRESET_MAP: Record<ShaderPresetName, ShaderPresetDef> =
  Object.fromEntries(SHADER_PRESETS.map((p) => [p.name, p])) as Record<
    ShaderPresetName,
    ShaderPresetDef
  >;

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/** Return a preset by name, or undefined if not found. */
export function getPreset(name: string): ShaderPresetDef | undefined {
  return SHADER_PRESET_MAP[name as ShaderPresetName];
}

/**
 * Validate a ShaderDescriptor against the manifest.
 * Returns { valid: true } or { valid: false, errors: string[] }.
 */
export function validateDescriptor(descriptor: ShaderDescriptor): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  const presetDef = getPreset(descriptor.preset);
  if (!presetDef) {
    errors.push(`Unknown preset: "${descriptor.preset}"`);
    return { valid: false, errors };
  }

  const paramMap = new Map<string, ParamDef>(
    presetDef.params.map((p) => [p.key, p]),
  );

  for (const [key, value] of Object.entries(descriptor.params)) {
    const def = paramMap.get(key);
    if (!def) {
      errors.push(
        `Unknown param key "${key}" for preset "${descriptor.preset}"`,
      );
      continue;
    }

    if (def.kind === "number") {
      const num = value as number;
      if (typeof num !== "number" || !isFinite(num)) {
        errors.push(`Param "${key}" must be a finite number`);
        continue;
      }
      if (def.min !== undefined && num < def.min) {
        errors.push(`Param "${key}" value ${num} is below minimum ${def.min}`);
      }
      if (def.max !== undefined && num > def.max) {
        errors.push(`Param "${key}" value ${num} is above maximum ${def.max}`);
      }
    } else if (def.kind === "enum") {
      if (def.options && !def.options.includes(value as string)) {
        errors.push(
          `Param "${key}" value "${value}" is not in allowed options: ${def.options.join(", ")}`,
        );
      }
    } else if (def.kind === "bool") {
      if (typeof value !== "boolean") {
        errors.push(`Param "${key}" must be a boolean`);
      }
    }
  }

  if (descriptor.colors !== undefined) {
    if (presetDef.maxColorCount !== undefined) {
      if (descriptor.colors.length > presetDef.maxColorCount) {
        errors.push(
          `colors array length ${descriptor.colors.length} exceeds maxColorCount ${presetDef.maxColorCount}`,
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ===========================================================================
// Code-backed GLSL preset library
// ===========================================================================
//
// Each preset carries a complete WebGL1 (GLSL ES 1.00) fragment source plus
// a uniforms manifest matching shared/shader-fills.ts. Applying a preset
// stamps the source into the screen HTML — after that it is the user's (and
// the agent's) code: fully editable in the Code panel, knobs driven by the
// manifest. Fills paint standalone backgrounds; effects render transparent
// overlays composited above the element's content.
//
// Built-ins available to every preset: u_time (seconds), u_resolution (px).

export type GlslShaderPresetCategory =
  | "gradient-flow"
  | "waves"
  | "noise"
  | "pattern"
  | "texture"
  | "retro";

export const GLSL_SHADER_PRESET_CATEGORY_LABELS: Record<
  GlslShaderPresetCategory,
  string
> = {
  "gradient-flow": "Gradient flow", // i18n-ignore shader preset category
  waves: "Waves", // i18n-ignore shader preset category
  noise: "Noise", // i18n-ignore shader preset category
  pattern: "Patterns", // i18n-ignore shader preset category
  texture: "Texture", // i18n-ignore shader preset category
  retro: "Retro", // i18n-ignore shader preset category
};

export interface GlslShaderPreset {
  /** Stable kebab-case preset id — seeds new shader ids/names. */
  name: string;
  label: string;
  description: string;
  category: GlslShaderPresetCategory;
  mode: GlslShaderMode;
  /** Static CSS approximation used for preset-grid thumbnails (no WebGL). */
  previewCss: string;
  uniforms: GlslUniformManifest;
  glsl: string;
}

const GLSL_NOISE_HELPERS = `
float anHash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float anValueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = anHash21(i);
  float b = anHash21(i + vec2(1.0, 0.0));
  float c = anHash21(i + vec2(0.0, 1.0));
  float d = anHash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float anFbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    v += amp * anValueNoise(p);
    p = p * 2.03 + vec2(17.13, 9.57);
    amp *= 0.5;
  }
  return v;
}
`.trim();

export const GLSL_SHADER_PRESETS: readonly GlslShaderPreset[] = [
  // ── Fills ─────────────────────────────────────────────────────────────────
  {
    name: "mesh-gradient",
    label: "Mesh Gradient",
    description:
      "Four color points drifting across the surface, blended by distance.",
    category: "gradient-flow",
    mode: "fill",
    previewCss:
      "radial-gradient(circle at 20% 25%, #ff9a9e 0%, transparent 55%), " +
      "radial-gradient(circle at 80% 25%, #a18cd1 0%, transparent 55%), " +
      "radial-gradient(circle at 25% 80%, #fbc2eb 0%, transparent 55%), " +
      "radial-gradient(circle at 80% 75%, #fad0c4 0%, transparent 60%), #a18cd1",
    uniforms: {
      u_color_a: { type: "color", value: "#ff9a9e", label: "Color 1" },
      u_color_b: { type: "color", value: "#a18cd1", label: "Color 2" },
      u_color_c: { type: "color", value: "#fbc2eb", label: "Color 3" },
      u_color_d: { type: "color", value: "#fad0c4", label: "Color 4" },
      u_drift: {
        type: "float",
        value: 0.6,
        min: 0,
        max: 2,
        step: 0.01,
        label: "Drift",
      },
      u_blend: {
        type: "float",
        value: 2.2,
        min: 0.5,
        max: 6,
        step: 0.05,
        label: "Blend",
      },
    },
    glsl: `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_color_a;
uniform vec3 u_color_b;
uniform vec3 u_color_c;
uniform vec3 u_color_d;
uniform float u_drift;
uniform float u_blend;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float t = u_time * u_drift;
  vec2 p0 = vec2(0.20 + 0.16 * sin(t * 0.60), 0.24 + 0.14 * cos(t * 0.50));
  vec2 p1 = vec2(0.82 + 0.12 * sin(t * 0.44 + 2.1), 0.28 + 0.16 * cos(t * 0.62 + 1.3));
  vec2 p2 = vec2(0.26 + 0.15 * sin(t * 0.52 + 4.2), 0.78 + 0.12 * cos(t * 0.47 + 2.8));
  vec2 p3 = vec2(0.78 + 0.14 * sin(t * 0.58 + 1.7), 0.76 + 0.15 * cos(t * 0.55 + 4.6));
  float w0 = 1.0 / pow(distance(uv, p0) + 0.02, u_blend);
  float w1 = 1.0 / pow(distance(uv, p1) + 0.02, u_blend);
  float w2 = 1.0 / pow(distance(uv, p2) + 0.02, u_blend);
  float w3 = 1.0 / pow(distance(uv, p3) + 0.02, u_blend);
  vec3 color = (u_color_a * w0 + u_color_b * w1 + u_color_c * w2 + u_color_d * w3)
    / (w0 + w1 + w2 + w3);
  gl_FragColor = vec4(color, 1.0);
}
`.trim(),
  },
  {
    name: "glowing-wave",
    label: "Glowing Wave",
    description:
      "Luminous sine waves with adjustable amplitude, frequency, and glow.",
    category: "waves",
    mode: "fill",
    previewCss:
      "linear-gradient(180deg, #05070f 32%, #59d9ff88 48%, #59d9ff 50%, " +
      "#59d9ff88 52%, #05070f 68%)",
    uniforms: {
      u_wave_color: { type: "color", value: "#59d9ff", label: "Wave color" },
      u_bg_color: { type: "color", value: "#05070f", label: "Background" },
      u_amplitude: {
        type: "float",
        value: 0.16,
        min: 0,
        max: 0.5,
        step: 0.005,
        label: "Amplitude",
      },
      u_frequency: {
        type: "float",
        value: 6,
        min: 1,
        max: 20,
        step: 0.1,
        label: "Frequency",
      },
      u_glow: {
        type: "float",
        value: 0.02,
        min: 0.002,
        max: 0.1,
        step: 0.001,
        label: "Glow",
      },
      u_speed: {
        type: "float",
        value: 1,
        min: 0,
        max: 4,
        step: 0.05,
        label: "Speed",
      },
    },
    glsl: `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_wave_color;
uniform vec3 u_bg_color;
uniform float u_amplitude;
uniform float u_frequency;
uniform float u_glow;
uniform float u_speed;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float t = u_time * u_speed;
  vec3 color = u_bg_color;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float phase = t * (0.7 + fi * 0.25) + fi * 2.4;
    float y = 0.5
      + u_amplitude * sin(uv.x * u_frequency + phase)
      + u_amplitude * 0.35 * sin(uv.x * u_frequency * 1.7 - phase * 1.3);
    float d = abs(uv.y - y);
    float glow = u_glow / max(d, 0.002);
    color += u_wave_color * min(glow, 8.0) * (0.6 - fi * 0.18) * 0.55;
  }
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`.trim(),
  },
  {
    name: "water-caustics",
    label: "Water Caustics",
    description:
      "Shimmering underwater light patterns with a loopable phase control.",
    category: "waves",
    mode: "fill",
    previewCss:
      "radial-gradient(circle at 30% 35%, #7fd4ff55 0%, transparent 45%), " +
      "radial-gradient(circle at 70% 60%, #7fd4ff33 0%, transparent 40%), #06283d",
    uniforms: {
      u_deep_color: { type: "color", value: "#06283d", label: "Water" },
      u_light_color: { type: "color", value: "#7fd4ff", label: "Light" },
      u_scale: {
        type: "float",
        value: 3,
        min: 1,
        max: 10,
        step: 0.1,
        label: "Scale",
      },
      u_phase: {
        type: "float",
        value: 0,
        min: 0,
        max: 1,
        step: 0.01,
        label: "Phase",
      },
      u_speed: {
        type: "float",
        value: 0.6,
        min: 0,
        max: 3,
        step: 0.05,
        label: "Speed",
      },
    },
    glsl: `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_deep_color;
uniform vec3 u_light_color;
uniform float u_scale;
uniform float u_phase;
uniform float u_speed;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 p = uv * u_scale;
  float t = u_time * u_speed + u_phase * 6.28318;
  vec2 i0 = p;
  float c = 0.0;
  for (int n = 0; n < 4; n++) {
    float fn = float(n);
    float tt = t * (1.0 - 0.075 * fn) + fn * 1.7;
    i0 = p + vec2(cos(tt - i0.x) + sin(tt + i0.y), sin(tt - i0.y) + cos(tt + i0.x));
    c += 1.0 / max(length(vec2(p.x / (sin(i0.x + tt) + 2.0), p.y / (cos(i0.y + tt) + 2.0))), 0.001);
  }
  c /= 4.0;
  c = 1.17 - pow(abs(c), 1.4);
  float glow = pow(abs(c), 8.0);
  vec3 color = u_deep_color + u_light_color * clamp(glow, 0.0, 1.0);
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`.trim(),
  },
  {
    name: "fractal-noise",
    label: "Fractal Noise",
    description: "Organic domain-warped fBm noise blended between two colors.",
    category: "noise",
    mode: "fill",
    previewCss:
      "radial-gradient(ellipse at 30% 30%, #e0aaff66 0%, transparent 60%), " +
      "radial-gradient(ellipse at 75% 70%, #e0aaff44 0%, transparent 55%), #10002b",
    uniforms: {
      u_color_a: { type: "color", value: "#10002b", label: "Base" },
      u_color_b: { type: "color", value: "#e0aaff", label: "Accent" },
      u_scale: {
        type: "float",
        value: 3,
        min: 0.5,
        max: 12,
        step: 0.1,
        label: "Scale",
      },
      u_contrast: {
        type: "float",
        value: 1.4,
        min: 0.2,
        max: 4,
        step: 0.05,
        label: "Contrast",
      },
      u_drift: {
        type: "float",
        value: 0.15,
        min: 0,
        max: 1,
        step: 0.01,
        label: "Drift",
      },
    },
    glsl: `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_color_a;
uniform vec3 u_color_b;
uniform float u_scale;
uniform float u_contrast;
uniform float u_drift;

${GLSL_NOISE_HELPERS}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 p = uv * u_scale + vec2(u_time * u_drift, 0.0);
  float warp = anFbm(p + vec2(u_time * u_drift * 0.5));
  float n = anFbm(p + warp * 1.6);
  n = clamp((n - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(mix(u_color_a, u_color_b, n), 1.0);
}
`.trim(),
  },
  {
    name: "clouds",
    label: "Clouds",
    description:
      "Procedural drifting clouds with adjustable coverage and scale.",
    category: "noise",
    mode: "fill",
    previewCss:
      "radial-gradient(ellipse at 30% 40%, #ffffffcc 0%, transparent 50%), " +
      "radial-gradient(ellipse at 70% 30%, #ffffff99 0%, transparent 45%), #5aa7e6",
    uniforms: {
      u_sky_color: { type: "color", value: "#5aa7e6", label: "Sky" },
      u_cloud_color: { type: "color", value: "#ffffff", label: "Clouds" },
      u_cover: {
        type: "float",
        value: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        label: "Coverage",
      },
      u_scale: {
        type: "float",
        value: 2.5,
        min: 0.5,
        max: 8,
        step: 0.1,
        label: "Scale",
      },
      u_drift: {
        type: "float",
        value: 0.4,
        min: 0,
        max: 2,
        step: 0.01,
        label: "Drift",
      },
    },
    glsl: `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_sky_color;
uniform vec3 u_cloud_color;
uniform float u_cover;
uniform float u_scale;
uniform float u_drift;

${GLSL_NOISE_HELPERS}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 p = vec2(uv.x * aspect, uv.y) * u_scale;
  p.x += u_time * u_drift * 0.2;
  float n = anFbm(p + anFbm(p * 1.4 + vec2(u_time * u_drift * 0.05)) * 1.2);
  float threshold = 1.0 - u_cover;
  float clouds = smoothstep(threshold - 0.25, threshold + 0.25, n);
  vec3 color = mix(u_sky_color, u_cloud_color, clouds);
  gl_FragColor = vec4(color, 1.0);
}
`.trim(),
  },
  {
    name: "nebula",
    label: "Nebula",
    description:
      "Deep-space gas clouds with twinkling stars and adjustable density.",
    category: "noise",
    mode: "fill",
    previewCss:
      "radial-gradient(ellipse at 30% 35%, #7b2ff766 0%, transparent 55%), " +
      "radial-gradient(ellipse at 72% 68%, #f107a344 0%, transparent 50%), #050014",
    uniforms: {
      u_color_a: { type: "color", value: "#7b2ff7", label: "Gas 1" },
      u_color_b: { type: "color", value: "#f107a3", label: "Gas 2" },
      u_density: {
        type: "float",
        value: 0.6,
        min: 0,
        max: 1,
        step: 0.01,
        label: "Density",
      },
      u_stars: {
        type: "float",
        value: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        label: "Stars",
      },
      u_drift: {
        type: "float",
        value: 0.08,
        min: 0,
        max: 0.5,
        step: 0.005,
        label: "Drift",
      },
    },
    glsl: `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_color_a;
uniform vec3 u_color_b;
uniform float u_density;
uniform float u_stars;
uniform float u_drift;

${GLSL_NOISE_HELPERS}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 p = vec2(uv.x * aspect, uv.y) * 3.0;
  vec2 drift = vec2(u_time * u_drift, u_time * u_drift * 0.6);
  float n1 = anFbm(p + drift);
  float n2 = anFbm(p * 1.7 - drift + 5.2);
  vec3 space = vec3(0.02, 0.0, 0.08);
  vec3 color = space;
  color += u_color_a * pow(n1, 2.0) * u_density * 1.6;
  color += u_color_b * pow(n2, 2.4) * u_density * 1.2;
  float sparkle = anHash21(floor(gl_FragCoord.xy / 2.0));
  float twinkle = 0.75 + 0.25 * sin(u_time * 3.0 + sparkle * 40.0);
  float star = step(0.9975, sparkle) * u_stars * twinkle;
  color += vec3(star);
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`.trim(),
  },
  {
    name: "moire",
    label: "Moiré",
    description:
      "Interfering ring fields producing shifting optical moiré patterns.",
    category: "pattern",
    mode: "fill",
    previewCss:
      "repeating-radial-gradient(circle at 42% 50%, #00f5d4 0 2px, #0f0f0f 2px 7px)",
    uniforms: {
      u_color_a: { type: "color", value: "#0f0f0f", label: "Background" },
      u_color_b: { type: "color", value: "#00f5d4", label: "Lines" },
      u_frequency: {
        type: "float",
        value: 42,
        min: 5,
        max: 120,
        step: 1,
        label: "Frequency",
      },
      u_offset: {
        type: "vec2",
        value: [0.12, 0.08],
        label: "Center offset",
      },
      u_speed: {
        type: "float",
        value: 0.2,
        min: 0,
        max: 2,
        step: 0.01,
        label: "Speed",
      },
    },
    glsl: `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_color_a;
uniform vec3 u_color_b;
uniform float u_frequency;
uniform vec2 u_offset;
uniform float u_speed;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 p = vec2(uv.x * aspect, uv.y);
  vec2 center = vec2(0.5 * aspect, 0.5);
  vec2 wobble = 0.02 * vec2(sin(u_time * u_speed * 3.0), cos(u_time * u_speed * 2.3));
  vec2 c1 = center + u_offset * 0.5 + wobble;
  vec2 c2 = center - u_offset * 0.5 - wobble;
  float r1 = sin(distance(p, c1) * u_frequency);
  float r2 = sin(distance(p, c2) * u_frequency);
  float v = r1 * r2 * 0.5 + 0.5;
  v = smoothstep(0.35, 0.65, v);
  gl_FragColor = vec4(mix(u_color_a, u_color_b, v), 1.0);
}
`.trim(),
  },
  {
    name: "concentric-rings",
    label: "Concentric Rings",
    description:
      "Bold expanding rings with adjustable count, softness, and center.",
    category: "pattern",
    mode: "fill",
    previewCss:
      "repeating-radial-gradient(circle at 50% 50%, #ffd166 0 6px, #101418 6px 16px)",
    uniforms: {
      u_color_a: { type: "color", value: "#101418", label: "Background" },
      u_color_b: { type: "color", value: "#ffd166", label: "Rings" },
      u_rings: {
        type: "float",
        value: 14,
        min: 2,
        max: 40,
        step: 1,
        label: "Rings",
      },
      u_center: { type: "vec2", value: [0.5, 0.5], label: "Center" },
      u_softness: {
        type: "float",
        value: 0.25,
        min: 0.01,
        max: 0.5,
        step: 0.01,
        label: "Softness",
      },
      u_speed: {
        type: "float",
        value: 0.4,
        min: -2,
        max: 2,
        step: 0.05,
        label: "Speed",
      },
    },
    glsl: `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_color_a;
uniform vec3 u_color_b;
uniform float u_rings;
uniform vec2 u_center;
uniform float u_softness;
uniform float u_speed;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 p = vec2(uv.x * aspect, uv.y);
  vec2 c = vec2(u_center.x * aspect, u_center.y);
  float d = distance(p, c);
  float v = 0.5 + 0.5 * sin((d * u_rings - u_time * u_speed) * 6.28318);
  float band = smoothstep(0.5 - u_softness, 0.5 + u_softness, v);
  gl_FragColor = vec4(mix(u_color_a, u_color_b, band), 1.0);
}
`.trim(),
  },
  {
    name: "pattern-grid",
    label: "Pattern Grid",
    description:
      "A grid of softly pulsing dots with adjustable cell count and radius.",
    category: "pattern",
    mode: "fill",
    previewCss:
      "radial-gradient(circle at 8px 8px, #e94560 3px, transparent 3.5px) 0 0 / 16px 16px, #1b1b2f",
    uniforms: {
      u_bg_color: { type: "color", value: "#1b1b2f", label: "Background" },
      u_fg_color: { type: "color", value: "#e94560", label: "Dots" },
      u_cells: {
        type: "float",
        value: 10,
        min: 2,
        max: 40,
        step: 1,
        label: "Cells",
      },
      u_radius: {
        type: "float",
        value: 0.28,
        min: 0.05,
        max: 0.48,
        step: 0.01,
        label: "Dot size",
      },
      u_pulse: {
        type: "float",
        value: 0.15,
        min: 0,
        max: 0.5,
        step: 0.01,
        label: "Pulse",
      },
    },
    glsl: `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_bg_color;
uniform vec3 u_fg_color;
uniform float u_cells;
uniform float u_radius;
uniform float u_pulse;

float anHash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 g = vec2(uv.x * aspect, uv.y) * u_cells;
  vec2 cell = floor(g);
  vec2 f = fract(g) - 0.5;
  float ph = anHash21(cell);
  float r = u_radius * (1.0 + u_pulse * sin(u_time * 2.0 + ph * 6.28318));
  float d = length(f);
  float m = 1.0 - smoothstep(r - 0.03, r + 0.03, d);
  gl_FragColor = vec4(mix(u_bg_color, u_fg_color, m), 1.0);
}
`.trim(),
  },
  // ── Effects (transparent overlays above the element's content) ───────────
  {
    name: "film-grain",
    label: "Film Grain",
    description:
      "Animated photographic grain composited over the layer content.",
    category: "texture",
    mode: "effect",
    previewCss:
      "repeating-conic-gradient(#0000 0% 25%, #00000018 0% 50%) 0 0 / 4px 4px, #8a8a8a40",
    uniforms: {
      u_intensity: {
        type: "float",
        value: 0.12,
        min: 0,
        max: 0.5,
        step: 0.01,
        label: "Intensity",
      },
      u_size: {
        type: "float",
        value: 1.5,
        min: 0.5,
        max: 4,
        step: 0.1,
        label: "Grain size",
      },
    },
    glsl: `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_intensity;
uniform float u_size;

float anHash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 cell = floor(gl_FragCoord.xy / max(u_size, 0.5));
  float frame = floor(u_time * 24.0);
  float n = anHash21(cell + vec2(frame * 0.013, frame * 0.007));
  float signed = n * 2.0 - 1.0;
  vec3 color = signed > 0.0 ? vec3(1.0) : vec3(0.0);
  gl_FragColor = vec4(color, abs(signed) * u_intensity);
}
`.trim(),
  },
  {
    name: "halftone",
    label: "Halftone",
    description:
      "Vintage print dot screen overlay with adjustable size and angle.",
    category: "retro",
    mode: "effect",
    previewCss:
      "radial-gradient(circle at 5px 5px, #14213d 2.5px, transparent 3px) 0 0 / 10px 10px",
    uniforms: {
      u_color: { type: "color", value: "#14213d", label: "Dot color" },
      u_size: {
        type: "float",
        value: 8,
        min: 3,
        max: 30,
        step: 0.5,
        label: "Dot size",
      },
      u_angle: {
        type: "float",
        value: 0.6,
        min: 0,
        max: 3.14,
        step: 0.01,
        label: "Angle",
      },
      u_strength: {
        type: "float",
        value: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        label: "Strength",
      },
    },
    glsl: `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_color;
uniform float u_size;
uniform float u_angle;
uniform float u_strength;

void main() {
  vec2 p = gl_FragCoord.xy;
  float s = sin(u_angle);
  float c = cos(u_angle);
  vec2 rp = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  vec2 f = fract(rp / max(u_size, 1.0)) - 0.5;
  float ramp = clamp(gl_FragCoord.y / max(u_resolution.y, 1.0), 0.0, 1.0);
  float r = mix(0.08, 0.62, 1.0 - ramp);
  float m = 1.0 - smoothstep(r - 0.08, r + 0.08, length(f) * 2.0);
  gl_FragColor = vec4(u_color, m * u_strength);
}
`.trim(),
  },
  {
    name: "scanlines",
    label: "Scanlines",
    description:
      "CRT-style scanlines with subtle flicker, composited over content.",
    category: "retro",
    mode: "effect",
    previewCss:
      "repeating-linear-gradient(180deg, #00000030 0 1px, transparent 1px 4px)",
    uniforms: {
      u_color: { type: "color", value: "#000000", label: "Line color" },
      u_density: {
        type: "float",
        value: 220,
        min: 40,
        max: 600,
        step: 5,
        label: "Density",
      },
      u_opacity: {
        type: "float",
        value: 0.18,
        min: 0,
        max: 0.6,
        step: 0.01,
        label: "Opacity",
      },
      u_flicker: {
        type: "float",
        value: 0.06,
        min: 0,
        max: 0.3,
        step: 0.01,
        label: "Flicker",
      },
    },
    glsl: `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_color;
uniform float u_density;
uniform float u_opacity;
uniform float u_flicker;

void main() {
  float y = gl_FragCoord.y / max(u_resolution.y, 1.0);
  float line = 0.5 + 0.5 * sin(y * u_density * 6.28318);
  float flicker = 1.0 + u_flicker * sin(u_time * 11.0);
  float a = (1.0 - smoothstep(0.35, 0.75, line)) * u_opacity * flicker;
  gl_FragColor = vec4(u_color, clamp(a, 0.0, 1.0));
}
`.trim(),
  },
] as const;

export const GLSL_SHADER_PRESET_MAP: Record<string, GlslShaderPreset> =
  Object.fromEntries(GLSL_SHADER_PRESETS.map((p) => [p.name, p]));

/** Return a GLSL preset by name, or undefined if not found. */
export function getGlslShaderPreset(
  name: string,
): GlslShaderPreset | undefined {
  return GLSL_SHADER_PRESET_MAP[name];
}
