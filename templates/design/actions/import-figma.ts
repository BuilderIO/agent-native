import { defineAction } from "@agent-native/core";
import { z } from "zod";

export default defineAction({
  description:
    "Process a Figma file description for design import. " +
    "Since .fig file parsing happens client-side, this action accepts a " +
    "text description of the Figma file contents and returns structured " +
    "context for the agent to use when creating the design project.",
  schema: z.object({
    description: z
      .string()
      .describe(
        "User's description of what is in the Figma file (components, pages, styles, etc.)",
      ),
    figmaUrl: z.string().optional().describe("Figma file URL for reference"),
    projectTitle: z
      .string()
      .optional()
      .describe("Suggested title for the imported design project"),
  }),
  readOnly: true,
  run: async ({ description, figmaUrl, projectTitle }) => {
    return {
      source: "figma",
      description,
      figmaUrl: figmaUrl ?? null,
      suggestedTitle: projectTitle ?? null,
      instructions:
        "Use this context to create a new design project. " +
        "Extract component structures, color palettes, typography, and layout patterns " +
        "from the description to populate the design files. " +
        "Create separate files for each major component or page described.",
    };
  },
});
