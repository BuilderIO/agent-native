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
  preset: z.enum(PRESET_NAMES),
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
  description:
    "Read a historical shader-fill descriptor without writing it. The retired preset cannot be applied as a new shader. Use get-shader to choose an exact registered native definition and edit-native-shader to apply it.",
  schema: z.object({
    descriptor: descriptorSchema,
    target: z
      .object({
        nodeId: z.string().optional(),
        selector: z.string().optional(),
      })
      .optional(),
    source: z
      .object({
        kind: z.enum(["design-file", "inline-html"]).default("design-file"),
        designId: z.string().optional(),
        fileId: z.string().optional(),
        revision: z.string().optional(),
        currentContent: z.string().optional(),
        html: z.string().optional(),
      })
      .optional(),
  }),
  readOnly: true,
  run: async ({ descriptor: rawDescriptor }) => {
    const descriptor: ShaderDescriptor = {
      preset: rawDescriptor.preset,
      params: rawDescriptor.params,
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
        persisted: false,
        code: "invalid-legacy-descriptor" as const,
        errors: validation.errors,
        descriptor,
      };
    }
    return {
      ok: false,
      persisted: false,
      code: "legacy-shader-retired" as const,
      descriptor,
      nativeAction: "edit-native-shader" as const,
    };
  },
});
