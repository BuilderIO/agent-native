import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  SHADER_PRESET_MAP,
  type ShaderDescriptor,
  type ShaderPresetName,
  validateDescriptor,
} from "../shared/shader-presets.js";

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
      "Historical shader preset identifier for compatibility inspection only; no executable shader is returned.",
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

export default defineAction({
  description: `
Inspect a historical shader descriptor. This compatibility action never emits JSX, canvas
mounts, or executable shader code. New shader fills and effects use get-shader to discover
registered native definitions and edit-native-shader to apply one exact version to a selected
Design node. Historical descriptors remain readable without implicitly changing their effect.
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
      .describe("Historical placement metadata; no new shader is emitted."),
    descriptor: descriptorSchema.describe(
      "Historical shader descriptor to inspect. Use get-shader and edit-native-shader for new effects.",
    ),
  }),
  readOnly: true,
  run: async ({ descriptor }) => {
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
        code: "invalid-legacy-descriptor" as const,
        errors: validation.errors,
        descriptor: desc,
        nativeAction: "edit-native-shader" as const,
      };
    }

    return {
      ok: false,
      code: "legacy-shader-retired" as const,
      descriptor: desc,
      nativeAction: "edit-native-shader" as const,
      message:
        "This saved shader descriptor is available for inspection only. Choose a registered native definition and exact version for a new fill or effect.",
    };
  },
});
