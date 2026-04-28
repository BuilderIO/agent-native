import { defineAction } from "@agent-native/core";
import { z } from "zod";

const HEX_COLOR_RE = /#(?:[0-9a-fA-F]{3,4}){1,2}\b/g;
const NAMED_COLOR_RE =
  /\b(red|blue|green|yellow|orange|purple|pink|cyan|magenta|teal|navy|maroon|coral|salmon|gold|silver|gray|grey|indigo|violet|lime|olive|aqua|fuchsia|crimson|turquoise|ivory|beige|lavender|tan|khaki|plum|orchid|sienna)\b/gi;
const FONT_NAME_RE =
  /\b(Helvetica|Arial|Times New Roman|Georgia|Garamond|Futura|Bodoni|Avenir|Proxima Nova|Montserrat|Open Sans|Lato|Poppins|Raleway|Playfair Display|Merriweather|Source Sans|Noto Sans|Work Sans|Nunito|Rubik|Oswald|Roboto|Inter|DM Sans|Space Grotesk|SF Pro|Segoe UI|Calibri|Cambria|Century Gothic|Franklin Gothic|Gill Sans|Fira Sans|Barlow|Manrope|Sora|Plus Jakarta Sans|IBM Plex Sans|IBM Plex Serif|Libre Baskerville|Cormorant|Crimson Text)\b/gi;

function unique(arr: string[]): string[] {
  return [...new Set(arr.map((s) => s.trim()))];
}

function extractColors(text: string): string[] {
  const hex = text.match(HEX_COLOR_RE) ?? [];
  const named = text.match(NAMED_COLOR_RE) ?? [];
  return unique([...hex, ...named.map((n) => n.toLowerCase())]);
}

function extractFonts(text: string): string[] {
  const matches = text.match(FONT_NAME_RE) ?? [];
  return unique(matches);
}

type ContentType =
  | "presentation"
  | "document"
  | "spreadsheet"
  | "pdf"
  | "other";

function classifyFile(fileType: string): ContentType {
  const ft = fileType.toLowerCase();
  if (
    ft.includes("pptx") ||
    ft.includes("ppt") ||
    ft.includes("presentation") ||
    ft.includes("keynote")
  )
    return "presentation";
  if (
    ft.includes("docx") ||
    ft.includes("doc") ||
    ft.includes("document") ||
    ft.includes("rtf")
  )
    return "document";
  if (
    ft.includes("xlsx") ||
    ft.includes("xls") ||
    ft.includes("spreadsheet") ||
    ft.includes("csv")
  )
    return "spreadsheet";
  if (ft.includes("pdf")) return "pdf";
  return "other";
}

function suggestionsForType(
  contentType: ContentType,
  hasText: boolean,
): string[] {
  const base: string[] = [];

  switch (contentType) {
    case "presentation":
      base.push(
        "Look for slide master/theme colors — these define the brand palette",
        "Check heading fonts on title slides for the brand typeface",
        "Note any accent colors used for callouts or highlights",
        "Slide backgrounds may reveal primary and secondary brand colors",
        "Chart/graph colors often match the brand accent palette",
      );
      break;
    case "document":
      base.push(
        "Heading styles reveal the typographic hierarchy and heading font",
        "Body text font is likely the primary readable typeface",
        "Look for colored headings or accent text for brand colors",
        "Document margins and spacing suggest preferred density",
        "Header/footer formatting may include brand colors or logos",
      );
      break;
    case "spreadsheet":
      base.push(
        "Header row colors often reflect the brand palette",
        "Conditional formatting colors may indicate status/accent colors",
        "Chart and graph colors are strong brand palette signals",
        "Cell background highlighting colors suggest accent palette",
      );
      break;
    case "pdf":
      base.push(
        "PDF may contain embedded brand guidelines or style specs",
        "Look for consistent heading colors and font choices",
        "Background colors and accent bars reveal brand palette",
      );
      break;
    case "other":
      base.push(
        "Examine any visual elements for recurring color patterns",
        "Note any typography that appears intentionally branded",
      );
      break;
  }

  if (!hasText) {
    base.push(
      "No text content was extracted — ask the user to paste key sections or send the file as a chat attachment for visual analysis",
    );
  }

  return base;
}

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
            .record(z.any())
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

      // Extract from text content if available
      if (file.textContent) {
        likelyColors = extractColors(file.textContent);
        likelyFonts = extractFonts(file.textContent);
      }

      // Merge in any client-side metadata
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
