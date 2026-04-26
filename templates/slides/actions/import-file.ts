import { defineAction } from "@agent-native/core";
import { z } from "zod";
import fs from "fs";
import path from "path";

export default defineAction({
  description:
    "Import a file (PPTX, DOCX, PDF) and extract content for creating slides. " +
    "For PPTX files, returns parsed slides with text and layout info ready for conversion. " +
    "For DOCX files, returns structured sections extracted from the document. " +
    "For PDF files, returns extracted text organized by page. " +
    "The agent can then use the extracted content to create a deck via create-deck or add-slide.",
  schema: z.object({
    filePath: z
      .string()
      .describe(
        "Server path to the uploaded file (e.g. data/uploads/file.pptx)",
      ),
    format: z
      .enum(["pptx", "docx", "pdf", "auto"])
      .optional()
      .default("auto")
      .describe("File format — auto-detected from extension if not specified"),
    deckId: z
      .string()
      .optional()
      .describe("Existing deck to import into (passed through for context)"),
  }),
  run: async ({ filePath, format, deckId }) => {
    // Resolve to absolute path
    const absPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(process.cwd(), filePath);

    // Path traversal guard: only allow files under data/uploads or the cwd
    const cwd = process.cwd();
    const uploadsDir = path.join(cwd, "data", "uploads");
    const resolved = path.resolve(absPath);
    if (
      !(
        resolved === uploadsDir || resolved.startsWith(uploadsDir + path.sep)
      ) &&
      !(resolved === cwd || resolved.startsWith(cwd + path.sep))
    ) {
      throw new Error(
        `Access denied: file path must be within the project directory`,
      );
    }

    if (!fs.existsSync(absPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fileBuffer = await fs.promises.readFile(absPath);

    // Detect format from extension if auto
    let detectedFormat = format;
    if (detectedFormat === "auto") {
      const ext = path.extname(absPath).toLowerCase();
      if (ext === ".pptx") detectedFormat = "pptx";
      else if (ext === ".docx") detectedFormat = "docx";
      else if (ext === ".pdf") detectedFormat = "pdf";
      else {
        throw new Error(
          `Cannot detect format from extension "${ext}". Supported: .pptx, .docx, .pdf`,
        );
      }
    }

    if (detectedFormat === "pptx") {
      const { parsePptx } =
        await import("../server/handlers/import/pptx-parser.js");
      const presentation = await parsePptx(fileBuffer);

      return {
        format: "pptx",
        title: presentation.title,
        slideCount: presentation.slides.length,
        slides: presentation.slides.map((slide, i) => ({
          index: i,
          texts: slide.texts.map((t) => t.content).join(" "),
          textRuns: slide.texts,
          imageCount: slide.images.length,
          imageNames: slide.images.map((img) => img.name),
          notes: slide.notes,
          layoutHint: slide.layoutHint,
        })),
        theme: presentation.theme,
        deckId,
      };
    }

    if (detectedFormat === "docx") {
      const { parseDocx } =
        await import("../server/handlers/import/docx-parser.js");
      const doc = await parseDocx(fileBuffer);

      return {
        format: "docx",
        title: doc.title,
        sectionCount: doc.sections.length,
        sections: doc.sections.map((s) => ({
          heading: s.heading,
          contentPreview: stripTags(s.content).slice(0, 500),
        })),
        textLength: doc.text.length,
        deckId,
      };
    }

    if (detectedFormat === "pdf") {
      const { PDFParse } = await import("pdf-parse");
      const pdf = new PDFParse(new Uint8Array(fileBuffer));
      const result = await pdf.getText();
      const pages = (result.pages || []) as { num: number; text: string }[];

      return {
        format: "pdf",
        title: `Imported PDF (${pages.length} pages)`,
        pageCount: pages.length,
        pages: pages.map((p) => ({
          pageNum: p.num,
          textPreview: p.text.slice(0, 500),
          textLength: p.text.length,
        })),
        deckId,
      };
    }

    throw new Error(`Unsupported format: ${detectedFormat}`);
  },
});

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}
