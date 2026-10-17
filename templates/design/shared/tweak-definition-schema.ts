import { z } from "zod";

export const tweakDefinitionsSchema = z.array(
  z.object({
    id: z.string(),
    label: z.string(),
    type: z.enum([
      "color-swatch",
      "color-swatches",
      "segment",
      "slider",
      "toggle",
    ]),
    options: z
      .array(
        z.object({
          label: z.string(),
          value: z.string(),
          color: z.string().optional(),
        }),
      )
      .optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    defaultValue: z.union([z.string(), z.number(), z.boolean()]),
    cssVar: z.string().optional(),
    unit: z.string().optional(),
  }),
);
