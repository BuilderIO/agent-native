import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  extractDocumentColors,
  extractDocumentFonts,
  classifyFile,
  suggestionsForType,
  unique,
} from "@agent-native/core/server/design-token-utils";

export default defineAction({
  description:
    "Process uploaded document metadata (DOCX, PPTX, PDF, XLSX) and return " +
    "structured design context. Since binary parsing happens client-side, this " +
    "action accepts pre-extracted text and metadata, scans for design cues " +
    "(colors, fonts, spacing), and returns structured hints the agent uses " +
    "when building or refining a design system.",
  schema: z.object({
    files: z
      .array(
        z.object({
          filename: z.string().describe("Original filename with extension"),
          fileType: z
            .string()
            .describe(
              "MIME type or extension (e.g. application/pdf, .docx, .pptx)",
            ),
          sizeBytes: z.number().describe("File size in bytes"),
          textContent: z
            .string()
            .optional()
            .describe(
              "Text extracted client-side (PDF text layer, PPTX slide text, etc.)",
            ),
          metadata: z
            .record(z.string(), z.any())
            .optional()
            .describe(
              "Additional metadata from client parsing (detected fonts, theme colors, etc.)",
            ),
        }),
      )
      .describe("Array of uploaded file metadata"),
  }),
  readOnly: true,
  run: async ({ files }) => {
    const processedFiles = files.map((file) => {
      const contentType = classifyFile(file.fileType);
      const hasText = !!file.textContent && file.textContent.trim().length > 0;

      let likelyColors: string[] = [];
      let likelyFonts: string[] = [];

      if (file.textContent) {
        likelyColors = extractDocumentColors(file.textContent);
        likelyFonts = extractDocumentFonts(file.textContent);
      }

      if (file.metadata) {
        if (Array.isArray(file.metadata.colors)) {
          likelyColors = unique([
            ...likelyColors,
            ...file.metadata.colors.map(String),
          ]);
        }
        if (Array.isArray(file.metadata.fonts)) {
          likelyFonts = unique([
            ...likelyFonts,
            ...file.metadata.fonts.map(String),
          ]);
        }
      }

      const suggestions = suggestionsForType(contentType, hasText);

      return {
        filename: file.filename,
        fileType: file.fileType,
        designHints: {
          likelyColors,
          likelyFonts,
          contentType,
          extractedText: file.textContent
            ? file.textContent.slice(0, 2000)
            : undefined,
          suggestions,
        },
      };
    });

    const fileTypes = processedFiles.map((f) => f.designHints.contentType);
    const hasPresentations = fileTypes.includes("presentation");
    const hasDocuments = fileTypes.includes("document");
    const hasSpreadsheets = fileTypes.includes("spreadsheet");

    let agentInstructions =
      "The user uploaded documents to inform the design system. ";

    if (hasPresentations) {
      agentInstructions +=
        "Presentations (PPTX) are the strongest source for brand colors and heading fonts — " +
        "prioritize any colors and fonts extracted from them. ";
    }
    if (hasDocuments) {
      agentInstructions +=
        "Documents (DOCX) reveal typography choices — body font, heading hierarchy, and text colors. ";
    }
    if (hasSpreadsheets) {
      agentInstructions +=
        "Spreadsheets (XLSX) may contain data visualization colors useful for chart palettes. ";
    }

    agentInstructions +=
      "Use the extracted colors and fonts as starting points for the design system. " +
      "If the extracted data is sparse, ask the user to send the file as a chat attachment " +
      "so you can visually analyze its contents. Cross-reference with any existing design " +
      "system or brand guidelines the user has set up.";

    return {
      source: "document",
      files: processedFiles,
      agentInstructions,
    };
  },
});
