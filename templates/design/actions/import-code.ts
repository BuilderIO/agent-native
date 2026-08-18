import { defineAction } from "@agent-native/core";
import { analyzeCodeFiles } from "@agent-native/core/brand-kit";
import { z } from "zod";

export default defineAction({
  description:
    "Extract design tokens from raw code files uploaded from the browser. " +
    "Analyzes CSS, Tailwind configs, JSON theme files, package.json, and " +
    "TypeScript/JavaScript theme files to extract colors, fonts, spacing, " +
    "border-radius, and CSS custom properties. Returns a structured summary " +
    "the agent can use to create or update a design system.",
  schema: z.object({
    files: z
      .array(
        z.object({
          filename: z.string().describe("File name or relative path"),
          content: z.string().describe("Raw text content of the file"),
        }),
      )
      .describe("Array of code files to analyze"),
  }),
  readOnly: true,
  run: async ({ files }) => {
    return analyzeCodeFiles(files);
  },
});
