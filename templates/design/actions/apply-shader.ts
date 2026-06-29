import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  SHADER_PRESET_MAP,
  type ShaderDescriptor,
  type ShaderPresetName,
  validateDescriptor,
} from "../shared/shader-presets.js";

// Zod v4 enum values must be an array
const PRESET_NAMES = Object.keys(SHADER_PRESET_MAP) as [
  ShaderPresetName,
  ...ShaderPresetName[],
];

const sourceSchema = z.object({
  kind: z.enum(["design-file", "inline-html"]).default("design-file"),
  designId: z.string().optional(),
  fileId: z.string().optional(),
  html: z.string().optional(),
});

const targetSchema = z.object({
  nodeId: z.string().optional(),
  selector: z.string().optional(),
});

const descriptorSchema = z.object({
  preset: z
    .enum(PRESET_NAMES)
    .describe(
      "One of the 8 shader presets: MeshGradient, GrainGradient, Voronoi, Metaballs, Warp, GodRays, Dithering, PaperTexture.",
    ),
  params: z
    .record(z.string(), z.union([z.number(), z.boolean(), z.string()]))
    .optional()
    .default({}),
  colors: z.array(z.string()).optional(),
  speed: z.number().optional(),
  frame: z.number().optional(),
  fit: z.enum(["none", "contain", "cover"]).optional(),
  scale: z.number().optional(),
  rotation: z.number().optional(),
  offsetX: z.number().optional(),
  offsetY: z.number().optional(),
});

/**
 * Serialize a JSX prop value to a JSX-safe string.
 * Strings become `"value"`, numbers and booleans become `{value}`.
 */
function serializePropValue(val: number | boolean | string): string {
  if (typeof val === "string") return `"${val}"`;
  return `{${val}}`;
}

/**
 * Build the JSX snippet + import line for a descriptor.
 * The result is copy-pasteable into a React/JSX source file.
 */
function buildJsxSnippet(
  descriptor: ShaderDescriptor,
  surface: "fill" | "effect",
): { importLine: string; jsxSnippet: string } {
  const presetDef = SHADER_PRESET_MAP[descriptor.preset];
  const componentName = descriptor.preset;

  const zIndex = surface === "fill" ? 0 : 2;
  const pointerEvents = surface === "effect" ? "none" : undefined;

  const styleEntries: string[] = [
    `position: "absolute"`,
    `inset: 0`,
    `zIndex: ${zIndex}`,
    `width: "100%"`,
    `height: "100%"`,
  ];
  if (pointerEvents) {
    styleEntries.push(`pointerEvents: "${pointerEvents}"`);
  }
  const styleStr = styleEntries.join(", ");

  const propLines: string[] = [];

  // Colors — use provided colors or fall back to preset defaults
  if (descriptor.colors && descriptor.colors.length > 0) {
    propLines.push(`  colors={${JSON.stringify(descriptor.colors)}}`);
  } else if (presetDef.defaultColors && presetDef.defaultColors.length > 0) {
    propLines.push(`  colors={${JSON.stringify(presetDef.defaultColors)}}`);
  }

  // Single-color params from preset defaults when not in colors array
  if (presetDef.defaultColorBack && !presetDef.defaultColors) {
    propLines.push(`  colorBack="${presetDef.defaultColorBack}"`);
  }
  if (presetDef.defaultColorFront && !presetDef.defaultColors) {
    propLines.push(`  colorFront="${presetDef.defaultColorFront}"`);
  }

  // Shader-specific params — merge preset defaults with descriptor overrides.
  // ParamDef.default can be string[] for "colors" kind params; skip those here.
  const defaultParamValues = Object.fromEntries(
    presetDef.params
      .filter((p) => !Array.isArray(p.default))
      .map((p) => [p.key, p.default as number | boolean | string]),
  );
  const mergedParams: Record<string, number | boolean | string> = {
    ...defaultParamValues,
    ...(descriptor.params ?? {}),
  };

  for (const [key, val] of Object.entries(mergedParams)) {
    propLines.push(`  ${key}=${serializePropValue(val)}`);
  }

  // Universal sizing/animation params from top-level descriptor fields
  if (descriptor.speed !== undefined)
    propLines.push(`  speed={${descriptor.speed}}`);
  if (descriptor.frame !== undefined)
    propLines.push(`  frame={${descriptor.frame}}`);
  if (descriptor.fit !== undefined) propLines.push(`  fit="${descriptor.fit}"`);
  if (descriptor.scale !== undefined)
    propLines.push(`  scale={${descriptor.scale}}`);
  if (descriptor.rotation !== undefined)
    propLines.push(`  rotation={${descriptor.rotation}}`);
  if (descriptor.offsetX !== undefined)
    propLines.push(`  offsetX={${descriptor.offsetX}}`);
  if (descriptor.offsetY !== undefined)
    propLines.push(`  offsetY={${descriptor.offsetY}}`);

  propLines.push(`  style={{ ${styleStr} }}`);

  const jsxSnippet = `<${componentName}\n${propLines.join("\n")}\n/>`;
  const importLine = `import { ${componentName} } from "@paper-design/shaders-react";`;

  return { importLine, jsxSnippet };
}

/**
 * Build the vanilla <canvas> data-shader element for inline HTML artboards.
 * The design runtime reads `data-shader` and mounts the WebGL shader into the canvas.
 */
function buildBridgeMount(
  descriptor: ShaderDescriptor,
  surface: "fill" | "effect",
): string {
  const zIndex = surface === "fill" ? 0 : 2;
  const pointerEvents = surface === "effect" ? "none" : "auto";
  // Escape single quotes in the JSON so the attribute is safe in single-quoted HTML
  const dataShader = JSON.stringify(descriptor).replace(/'/g, "&#39;");

  return (
    `<canvas\n` +
    `  data-shader='${dataShader}'\n` +
    `  style="position:absolute;inset:0;width:100%;height:100%;` +
    `z-index:${zIndex};pointer-events:${pointerEvents};"\n` +
    `></canvas>`
  );
}

export default defineAction({
  description: `
Apply a GPU shader effect to a design element by validating params and returning the exact code
to insert. This is a planning/validation action — it does not write files itself; the agent
uses the returned snippets to make the actual edit via edit-design or apply-visual-edit.

Available presets (8 total):
- MeshGradient: Smooth flowing color spots with distortion + swirl. Best for hero/card fills. Accepts up to 10 colors.
- GrainGradient: Noisy gradient in 7 shape modes (wave, dots, truchet, corners, ripple, blob, sphere). Up to 7 colors + colorBack.
- Voronoi: Animated Voronoi cells with glow and gap colors. Good for geometric/abstract backgrounds.
- Metaballs: Organic blobs that merge and split. Playful, great for marketing backgrounds.
- Warp: Domain-warped distortion in several shape patterns (checks, cross, circle, star, waves, spiral). Abstract / high-energy.
- GodRays: Volumetric light rays from a configurable source. Dramatic lighting effects.
- Dithering: Ordered dithering overlay (composites over the layer beneath). Use surface="effect".
- PaperTexture: Procedural paper with grain, fiber, crumples, and folds. Static by default (no animation).

surface="fill" places the shader behind content (z-index 0, pointer-events auto).
surface="effect" places it in front (z-index 2, pointer-events none) — use for overlays like Dithering.

Framework artboards (React/JSX files): paste the returned importLine at the top and jsxSnippet
inside the container element. The agent should call edit-design with the exact text.

Inline/Alpine artboards (HTML files): inject the returned bridgeMount <canvas> element at the
top of the container. The design runtime automatically mounts the shader.
  `.trim(),
  schema: z.object({
    source: sourceSchema
      .optional()
      .describe(
        "Design source for context. kind=design-file uses the SQL-backed file; kind=inline-html operates on inline HTML.",
      ),
    target: targetSchema
      .optional()
      .describe(
        "Target element by nodeId or CSS selector. When omitted, the shader targets the root artboard container.",
      ),
    surface: z
      .enum(["fill", "effect"])
      .default("fill")
      .describe(
        'fill: shader sits behind content (z-index 0). effect: shader composites over content (z-index 2, pointer-events none). Use "effect" for Dithering.',
      ),
    descriptor: descriptorSchema.describe(
      "Shader preset + params to apply. Use get-shader first to see available presets and current state.",
    ),
  }),
  readOnly: true,
  run: async ({ descriptor, surface, target }) => {
    // Cast to ShaderDescriptor for the shared helpers
    const desc: ShaderDescriptor = {
      preset: descriptor.preset as ShaderPresetName,
      params: descriptor.params ?? {},
      colors: descriptor.colors,
      speed: descriptor.speed,
      frame: descriptor.frame,
      fit: descriptor.fit,
      scale: descriptor.scale,
      rotation: descriptor.rotation,
      offsetX: descriptor.offsetX,
      offsetY: descriptor.offsetY,
    };

    const validation = validateDescriptor(desc);
    if (!validation.valid) {
      return {
        ok: false,
        errors: validation.errors,
        descriptor: desc,
        availablePresets: Object.keys(SHADER_PRESET_MAP),
      };
    }

    const { importLine, jsxSnippet } = buildJsxSnippet(desc, surface);
    const bridgeMount = buildBridgeMount(desc, surface);

    const targetDescription = target?.nodeId
      ? `node with id="${target.nodeId}"`
      : target?.selector
        ? `element matching selector "${target.selector}"`
        : "the root artboard container element";

    const instructions = [
      `To apply the "${desc.preset}" shader as a ${surface} to ${targetDescription}:`,
      "",
      "== For React/JSX (framework artboard) ==",
      `1. Add this import near the top of the component file (if not already present):`,
      `   ${importLine}`,
      `2. Inside ${targetDescription}, insert as the ${surface === "fill" ? "first" : "last"} child:`,
      jsxSnippet
        .split("\n")
        .map((l) => `   ${l}`)
        .join("\n"),
      `   The parent element must have position:relative (or position:absolute/fixed) for the absolute positioning to work.`,
      "",
      "== For inline HTML artboard ==",
      `1. Inside ${targetDescription}, insert as the ${surface === "fill" ? "first" : "last"} child:`,
      bridgeMount
        .split("\n")
        .map((l) => `   ${l}`)
        .join("\n"),
      `   The parent element must have position:relative for the absolute positioning to work.`,
      "",
      "Use edit-design for JSX files (structural insert) or apply-visual-edit for inline HTML.",
    ].join("\n");

    return {
      ok: true,
      descriptor: desc,
      surface,
      importLine,
      jsxSnippet,
      bridgeMount,
      instructions,
    };
  },
});
