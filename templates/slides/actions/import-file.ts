import { defineAction } from "@agent-native/core";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { getDb, schema } from "../server/db/index.js";
import { notifyClients } from "../server/handlers/decks.js";
import { resolveUserUploadedFile } from "./_uploaded-files.js";

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
    importIntoDeck: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "If true, replace deckId's slides with slides converted from the file.",
      ),
  }),
  run: async ({ filePath, format, deckId, importIntoDeck }) => {
    const absPath = resolveUserUploadedFile(filePath);

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
      const { convertToSlideHtml } =
        await import("../server/handlers/import/html-converter.js");
      const presentation = await parsePptx(fileBuffer);
      const title = presentation.title || titleFromPath(absPath);

      if (importIntoDeck) {
        if (!deckId) throw new Error("deckId is required to import into deck");
        const slides = presentation.slides.map((slide) => ({
          id: newSlideId(),
          content: convertToSlideHtml(slide),
          layout: slide.layoutHint ?? "content",
          notes: slide.notes,
        }));
        await replaceDeckSlides(deckId, title, slides, "import-file:pptx");
        return {
          format: "pptx",
          title,
          slideCount: slides.length,
          theme: presentation.theme,
          deckId,
          imported: true,
        };
      }

      return {
        format: "pptx",
        title,
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
      const { convertSectionsToSlides } =
        await import("../server/handlers/import/html-converter.js");
      const doc = await parseDocx(fileBuffer);
      const slideHtmlArray = convertSectionsToSlides(doc.sections);
      const title = doc.title || titleFromPath(absPath);

      if (importIntoDeck) {
        if (!deckId) throw new Error("deckId is required to import into deck");
        if (slideHtmlArray.length === 0) {
          throw new Error("No importable text found in this DOCX file");
        }
        const slides = slideHtmlArray.map((content) => ({
          id: newSlideId(),
          content,
          layout: "content",
          notes: "",
        }));
        await replaceDeckSlides(deckId, title, slides, "import-file:docx");
        return {
          format: "docx",
          title,
          sectionCount: doc.sections.length,
          slideCount: slides.length,
          textLength: doc.text.length,
          deckId,
          imported: true,
        };
      }

      return {
        format: "docx",
        title,
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
      const { convertSectionsToSlides } =
        await import("../server/handlers/import/html-converter.js");
      const pdf = new PDFParse(new Uint8Array(fileBuffer));
      const result = await pdf.getText();
      const pages = normalizePdfPages(result);
      const textPages = pages.filter((p) => p.text.trim());
      const title = titleFromPath(absPath);

      if (importIntoDeck) {
        if (!deckId) throw new Error("deckId is required to import into deck");
        if (textPages.length === 0) {
          throw new Error(
            "No importable text found in this PDF. Scanned PDFs need OCR first.",
          );
        }
        const sections = textPages.map((p) => ({
          heading: `Page ${p.num}`,
          content: p.text,
        }));
        const slideHtmlArray = convertSectionsToSlides(sections);
        const slides = slideHtmlArray.map((content) => ({
          id: newSlideId(),
          content,
          layout: "content",
          notes: "",
        }));
        await replaceDeckSlides(deckId, title, slides, "import-file:pdf");
        return {
          format: "pdf",
          title,
          pageCount: pages.length,
          slideCount: slides.length,
          deckId,
          imported: true,
        };
      }

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

function newSlideId(): string {
  return `slide-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function titleFromPath(filePath: string): string {
  const base = path.basename(filePath, path.extname(filePath)).trim();
  return base || "Imported File";
}

function normalizePdfPages(result: unknown): { num: number; text: string }[] {
  const data = result as {
    pages?: Array<{ num?: number; text?: string }>;
    text?: string;
  };
  if (Array.isArray(data.pages) && data.pages.length > 0) {
    return data.pages.map((p, i) => ({
      num: typeof p.num === "number" ? p.num : i + 1,
      text: typeof p.text === "string" ? p.text : "",
    }));
  }
  const text = typeof data.text === "string" ? data.text.trim() : "";
  if (!text) return [];
  return text.split(/\f+/).map((pageText, i) => ({
    num: i + 1,
    text: pageText.trim(),
  }));
}

async function replaceDeckSlides(
  deckId: string,
  title: string,
  slides: Array<{
    id: string;
    content: string;
    layout: string;
    notes?: string;
  }>,
  source: string,
) {
  await assertAccess("deck", deckId, "editor");

  const db = getDb();
  const existing = await db
    .select()
    .from(schema.decks)
    .where(eq(schema.decks.id, deckId))
    .limit(1);

  if (!existing.length) {
    throw new Error(`Deck ${deckId} not found`);
  }

  const now = new Date().toISOString();
  const previousData = safeParseDeckData(existing[0].data);
  const data = {
    ...previousData,
    title,
    slides,
    updatedAt: now,
  };

  await db
    .update(schema.decks)
    .set({
      title,
      data: JSON.stringify(data),
      updatedAt: now,
    })
    .where(eq(schema.decks.id, deckId));

  notifyClients(deckId);
  await writeAppState("refresh-signal", { ts: now, source });
}

function safeParseDeckData(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}
