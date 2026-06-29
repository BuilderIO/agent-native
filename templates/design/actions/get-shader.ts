import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  SHADER_PRESET_MAP,
  SHADER_PRESETS,
  type ShaderPresetName,
} from "../shared/shader-presets.js";

export default defineAction({
  description:
    "Return the available GPU shader preset catalog and instructions for reading current shader state " +
    "on a design element. Because shader state lives in source code (JSX props or data-shader attributes), " +
    "this action cannot parse live values itself — it returns the full preset catalog and oriented guidance " +
    "so the agent knows what to look for when inspecting the code. " +
    "Call get-code-layer-projection to read the actual HTML/JSX, then look for data-shader attributes " +
    "(inline HTML mode) or @paper-design/shaders-react component names (framework mode).",
  schema: z.object({
    source: z
      .object({
        kind: z.enum(["design-file", "inline-html"]).default("design-file"),
        designId: z.string().optional(),
        fileId: z.string().optional(),
      })
      .optional()
      .describe(
        "Optional design source context. When provided, the instructions are tailored to the source kind.",
      ),
    target: z
      .object({
        nodeId: z.string().optional(),
        selector: z.string().optional(),
      })
      .optional()
      .describe(
        "Optional target element. When provided, the inspection hint is scoped to that element.",
      ),
  }),
  readOnly: true,
  run: async ({ source, target }) => {
    const sourceKind = source?.kind ?? "design-file";
    const targetDescription = target?.nodeId
      ? `element with id="${target.nodeId}"`
      : target?.selector
        ? `element matching "${target.selector}"`
        : "any element";

    const availablePresets = (
      Object.keys(SHADER_PRESET_MAP) as ShaderPresetName[]
    ).map((name) => {
      const def = SHADER_PRESET_MAP[name];
      return {
        name,
        label: def.label,
        description: def.description,
        isEffect: def.isEffect ?? false,
        maxColorCount: def.maxColorCount,
        paramKeys: def.params.map((p) => p.key),
      };
    });

    const presetSummaryLines = SHADER_PRESETS.map((p) => {
      const paramKeys = p.params.map((param) => param.key).join(", ");
      return `  ${p.name} (${p.label}): ${p.description}${paramKeys ? ` — params: ${paramKeys}` : ""}`;
    });

    const inspectionStepsFramework = [
      `1. Call get-code-layer-projection with the design source to retrieve the rendered HTML or JSX.`,
      `2. Look for any import from "@paper-design/shaders-react".`,
      `   If found, note the imported component name — that is the active preset.`,
      `3. Read the component's JSX props: colors, colorBack, colorFront, speed, frame, fit, scale,`,
      `   rotation, offsetX, offsetY, and any shader-specific params (distortion, swirl, shape, etc.).`,
      `4. The zIndex prop (or style.zIndex) tells you whether it's a fill (0) or effect (2).`,
      `5. Reconstruct the ShaderDescriptor from those props to pass back to apply-shader if editing.`,
    ];

    const inspectionStepsInline = [
      `1. Call get-code-layer-projection with the design source to retrieve the rendered HTML.`,
      `2. Look for <canvas data-shader='...'> elements${target ? ` inside ${targetDescription}` : ""}.`,
      `3. Parse the data-shader JSON attribute — it is a ShaderDescriptor object with`,
      `   { preset, params, colors?, speed?, frame?, fit?, scale?, rotation?, offsetX?, offsetY? }.`,
      `4. The canvas element's inline style z-index tells you whether it's a fill (0) or effect (2).`,
      `5. To update the shader, modify the data-shader attribute value via apply-visual-edit`,
      `   with a style or attribute intent, or use apply-shader to regenerate the canvas element.`,
    ];

    const inspectionSteps =
      sourceKind === "inline-html"
        ? inspectionStepsInline
        : inspectionStepsFramework;

    const hint =
      sourceKind === "inline-html"
        ? `Search the HTML for data-shader attributes. The value is a JSON ShaderDescriptor. ` +
          `Example: data-shader='{"preset":"MeshGradient","params":{"distortion":0.8},"colors":["#e0eaff","#241d9a"]}'.`
        : `Search the JSX for imports from "@paper-design/shaders-react" and look for the component ` +
          `(e.g. <MeshGradient colors={[...]} distortion={0.8} style={{...}} />). ` +
          `The component name is the preset name.`;

    const instructions = [
      `To read the current shader state on ${targetDescription}:`,
      "",
      ...inspectionSteps,
      "",
      `Hint: ${hint}`,
      "",
      `To apply or change a shader, call apply-shader with the desired descriptor.`,
      `apply-shader validates params and returns the exact JSX or HTML to insert.`,
    ].join("\n");

    return {
      availablePresets,
      presetNames: availablePresets.map((p) => p.name),
      presetSummary: presetSummaryLines.join("\n"),
      instructions,
      hint,
    };
  },
});
