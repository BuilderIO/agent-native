import { z } from "zod";

export const tweakDefinitionsSchema = z.array(
  z.object({
    id: z.string().describe("Unique id of the tweak within this design"),
    label: z.string().describe("Label shown on the tweak control"),
    type: z
      .enum(["color-swatch", "color-swatches", "segment", "slider", "toggle"])
      .describe("Kind of control"),
    options: z
      .array(
        z.object({
          label: z.string().describe("Label shown for this choice"),
          value: z
            .string()
            .describe("Value applied when this choice is picked"),
          color: z.string().optional().describe("Swatch color for this choice"),
        }),
      )
      .optional()
      .describe(
        "Choices for a tweak that offers a set of them, as objects with a label and a value, not plain strings",
      ),
    min: z.number().optional().describe("Minimum value, for sliders"),
    max: z.number().optional().describe("Maximum value, for sliders"),
    step: z.number().optional().describe("Increment, for sliders"),
    defaultValue: z
      .union([z.string(), z.number(), z.boolean()])
      .describe("Initial value of the control"),
    cssVar: z
      .string()
      .optional()
      .describe("CSS custom property the tweak sets"),
    unit: z.string().optional().describe("Unit shown with the value"),
  }),
);
