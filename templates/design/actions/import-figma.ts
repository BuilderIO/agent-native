import { defineAction } from "@agent-native/core";
import { z } from "zod";

export default defineAction({
  description:
    "Turn a Figma file into a design system or design project. " +
    "PREFERRED: if a Figma MCP is connected (tools like `get_variable_defs`, " +
    "`get_design_context`, `get_metadata`, `get_screenshot`), call those FIRST " +
    "on the file/selection to extract real variables (tokens), colors, " +
    "typography, spacing and a screenshot — then pass a concise summary here " +
    "and follow up with `create-design-system`. If no Figma MCP is available, " +
    "ask the user to describe the file (or paste token values) and pass that as " +
    "`description`. Returns structured context for building the design.",
  schema: z.object({
    figmaUrl: z
      .string()
      .optional()
      .describe("Figma file/frame URL (figma.com/design/<key>...)"),
    description: z
      .string()
      .optional()
      .describe(
        "Summary of the file's tokens/components/pages — ideally the output of " +
          "the Figma MCP (variable defs, color/text styles), else the user's " +
          "description.",
      ),
    projectTitle: z
      .string()
      .optional()
      .describe("Suggested title for the imported design project or system"),
  }),
  readOnly: true,
  run: async ({ figmaUrl, description, projectTitle }) => {
    return {
      source: "figma",
      figmaUrl: figmaUrl ?? null,
      description: description ?? null,
      suggestedTitle: projectTitle ?? null,
      instructions: [
        "Build the design system / design from the extracted Figma data:",
        "1. If a Figma MCP is connected and you have not yet, call its token/" +
          "context tools (get_variable_defs for tokens, get_design_context or " +
          "get_metadata for structure, get_screenshot for the visual) on the " +
          "file or selection before continuing.",
        "2. Map the extracted variables/styles to DesignSystemData (colors, " +
          "typography, spacing, borders) and call create-design-system; set it " +
          "as default if the user wants it applied to new designs.",
        "3. Convert Figma colors (0-1 RGBA) to hex, effects to CSS box-shadow, " +
          "and text styles to font tokens. Cluster spacing onto a 4/8px scale.",
        "4. For a full design, create separate files per page/major frame and " +
          "ground every value in :root CSS variables from the system.",
      ].join("\n"),
    };
  },
});
