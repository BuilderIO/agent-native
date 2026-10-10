export type ParamKind = "number" | "color" | "enum" | "bool" | "colors";

export interface ParamDef {
  key: string;
  kind: ParamKind;
  label: string;
  default: number | boolean | string | string[];
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  maxCount?: number;
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

export interface ShaderDescriptor {
  preset: ShaderPresetName;
  params: Record<string, number | boolean | string>;
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
  defaultColors?: string[];
  defaultColorBack?: string;
  defaultColorFront?: string;
  defaultColorBloom?: string;
  defaultColorGlow?: string;
  defaultColorGap?: string;
  params: ParamDef[];
  maxColorCount?: number;
  isEffect?: boolean;
}

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

export const SHADER_PRESETS: readonly ShaderPresetDef[] = [
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

export const SHADER_PRESET_MAP: Record<ShaderPresetName, ShaderPresetDef> =
  Object.fromEntries(SHADER_PRESETS.map((p) => [p.name, p])) as Record<
    ShaderPresetName,
    ShaderPresetDef
  >;

export function getPreset(name: string): ShaderPresetDef | undefined {
  return SHADER_PRESET_MAP[name as ShaderPresetName];
}

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
