import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  createCodeAnalysisState,
  analyzeCodeFile,
  CODE_MAX_FILES,
  CODE_MAX_TOTAL_BYTES,
} from "@agent-native/core/server/design-token-utils";

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
    const truncated = files.slice(0, CODE_MAX_FILES);
    let totalBytes = 0;
    const accepted: { filename: string; content: string }[] = [];
    for (const file of truncated) {
      const size = new TextEncoder().encode(file.content).byteLength;
      if (totalBytes + size > CODE_MAX_TOTAL_BYTES) break;
      totalBytes += size;
      accepted.push(file);
    }

    const state = createCodeAnalysisState();
    const filesAnalyzed: string[] = [];

    for (const file of accepted) {
      filesAnalyzed.push(file.filename);
      analyzeCodeFile(state, file.filename, file.content);
    }

    const cappedColors = Object.fromEntries(
      Object.entries(state.colors).slice(0, 60),
    );
    const cappedCssProps = Object.fromEntries(
      Object.entries(state.cssCustomProperties).slice(0, 80),
    );

    return {
      source: "code" as const,
      fileCount: accepted.length,
      filesAnalyzed,
      colors: cappedColors,
      cssCustomProperties: cappedCssProps,
      fonts: state.fonts.slice(0, 20),
      spacing: state.spacing,
      borderRadius: state.borderRadius,
      stylingFramework: state.stylingFramework,
      rawExtracts: state.rawExtracts,
    };
  },
});
