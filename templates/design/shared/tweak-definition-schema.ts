import { z } from "zod";

const tweakScopeSchema = z.object({
  screenId: z
    .string()
    .optional()
    .describe("Screen (file) id the tweak belongs to"),
  nodeId: z
    .string()
    .optional()
    .describe(
      "data-agent-native-node-id of the element the tweak drives, such as a shader or 3D canvas",
    ),
  selector: z
    .string()
    .optional()
    .describe(
      "CSS selector of that element, for URL-backed screens without node ids",
    ),
});

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
    scope: z
      .union([tweakScopeSchema, z.array(tweakScopeSchema).min(1).max(32)])
      .optional()
      .describe(
        "Where the knob shows in the inspector's Tweaks section: when that screen, the element, or one of its ancestors or descendants is selected. Pass a list when one knob drives several screens (for example a remix and its explainer frames); it shows on each. Omit for a design-wide tweak that shows on every screen.",
      ),
  }),
);
