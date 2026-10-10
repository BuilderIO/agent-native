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

const descriptorSchema = z.object({
  preset: z
    .enum(PRESET_NAMES)
    .describe("Shader preset name.  One of: " + PRESET_NAMES.join(", ")),
  params: z
    .record(z.string(), z.union([z.number(), z.boolean(), z.string()]))
    .optional()
    .default({})
    .describe("Shader-specific params.  Merge with preset defaults."),
  colors: z
    .array(z.string())
    .optional()
    .describe("Colour palette override.  Falls back to preset defaults."),
  speed: z
    .number()
    .optional()
    .describe(
      "Animation speed multiplier (1 = normal).  Stored for future motion keyframe support; no effect on the static CSS preview.",
    ),
  frame: z.number().optional().describe("Static frame time (0–10000)."),
  fit: z.enum(["none", "contain", "cover"]).optional(),
  scale: z.number().optional(),
  rotation: z.number().optional().describe("Rotation in radians."),
  offsetX: z.number().optional(),
  offsetY: z.number().optional(),
});

const targetSchema = z
  .object({
    nodeId: z.string().optional(),
    selector: z.string().optional(),
  })
  .optional()
  .describe(
    "Target element.  Provide nodeId or CSS selector.  When omitted, the root artboard container is targeted.",
  );

export default defineAction({
  description:
    "Read a historical shader-fill descriptor. The retired CSS approximation is not a native shader preview. For new work, choose a registered native definition with get-shader and apply it with edit-native-shader.",
  schema: z.object({
    descriptor: descriptorSchema,
    target: targetSchema,
  }),
  readOnly: true,
  run: async ({ descriptor: rawDescriptor }) => {
    const descriptor: ShaderDescriptor = {
      preset: rawDescriptor.preset as ShaderPresetName,
      params: rawDescriptor.params ?? {},
      colors: rawDescriptor.colors,
      speed: rawDescriptor.speed,
      frame: rawDescriptor.frame,
      fit: rawDescriptor.fit,
      scale: rawDescriptor.scale,
      rotation: rawDescriptor.rotation,
      offsetX: rawDescriptor.offsetX,
      offsetY: rawDescriptor.offsetY,
    };

    const validation = validateDescriptor(descriptor);
    if (!validation.valid) {
      return {
        ok: false,
        errors: validation.errors,
        descriptor,
        hint: "Read this historical descriptor only. Call get-shader with format=native-v2 for current definitions.",
      };
    }

    return {
      ok: false,
      code: "legacy-shader-retired" as const,
      descriptor,
      nativeAction: "edit-native-shader" as const,
    };
  },
});
