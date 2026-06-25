import fs from "fs";
import path from "path";

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { notifyClients } from "../server/handlers/decks.js";
import { parseSlidesFigDesignSystem } from "../server/lib/fig-design-system.js";
import { resolveUserUploadedFile } from "./_uploaded-files.js";

const DEFAULT_MAX_SOURCE_CHARS = 60_000;

export default defineAction({
  description:
    "Import a file (PPTX, DOCX, PDF, FIG) and extract content for creating slides or slide design systems. " +
    "For PPTX files, returns parsed slides with text and layout info ready for conversion. " +
    "For DOCX files, returns structured sections extracted from the document. " +
    "For PDF files, returns extracted text organized by page. " +
    "For Figma .fig files, returns extracted brand/design-system tokens and a preview; call create-design-system with the returned data. " +
    "The agent can then use the extracted content to create a deck via create-deck or add-slide, or create a design system from .fig tokens.",
  schema: z.object({
    filePath: z
      .string()
      .describe(
        "Server path to the uploaded file (e.g. data/uploads/file.pptx)",
      ),
    format: z
      .enum(["pptx", "docx", "pdf", "fig", "auto"])
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
    maxChars: z.coerce
      .number()
      .int()
      .min(1000)
      .max(100_000)
      .optional()
      .describe(
        "Maximum extracted source characters to return when not importing directly into a deck (default 60000).",
      ),
  }),
  run: async ({ filePath, format, deckId, importIntoDeck, maxChars }) => {
    const absPath = resolveUserUploadedFile(filePath);
    const sourceLimit = maxChars ?? DEFAULT_MAX_SOURCE_CHARS;

    const fileBuffer = await fs.promises.readFile(absPath);

    // Detect format from extension if auto
    let detectedFormat = format;
    if (detectedFormat === "auto") {
      const ext = path.extname(absPath).toLowerCase();
      if (ext === ".pptx") detectedFormat = "pptx";
      else if (ext === ".docx") detectedFormat = "docx";
      else if (ext === ".pdf") detectedFormat = "pdf";
      else if (ext === ".fig") detectedFormat = "fig";
      else {
        throw new Error(
          `Cannot detect format from extension "${ext}". Supported: .pptx, .docx, .pdf, .fig`,
        );
      }
    }

    if (detectedFormat === "fig") {
      if (importIntoDeck) {
        throw new Error(
          "Figma .fig imports create design systems, not slide replacements. Re-run without importIntoDeck, then call create-design-system with the returned data.",
        );
      }
      const result = parseSlidesFigDesignSystem({
        data: fileBuffer,
        filename: path.basename(absPath),
      });
      return {
        format: "fig",
        title: result.suggestedTitle,
        designSystem: result.data,
        customInstructions: result.customInstructions,
        preview: result.preview,
        deckId,
        instructions: [
          "Parsed the .fig file and extracted a slide-ready design system.",
          "Call create-design-system with:",
          `- title: ${JSON.stringify(result.suggestedTitle)}`,
          "- data: JSON.stringify(designSystem)",
          "- customInstructions: the returned customInstructions string",
          "Then set it as default or apply it to a deck if the user asked.",
        ].join("\n"),
      };
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
        text: truncateText(doc.text, sourceLimit).text,
        sections: summarizeSections(doc.sections),
        textLength: doc.text.length,
        truncated: doc.text.length > sourceLimit,
        note:
          doc.text.length > sourceLimit
            ? `Returned the first ${sourceLimit} extracted characters. Re-run with a higher maxChars value if more source context is needed.`
            : undefined,
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

      if (textPages.length === 0) {
        throw new Error(
          "No importable text found in this PDF. Scanned PDFs need OCR first.",
        );
      }

      if (importIntoDeck) {
        if (!deckId) throw new Error("deckId is required to import into deck");
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
      const totalTextLength = textPages.reduce(
        (sum, p) => sum + p.text.length,
        0,
      );

      return {
        format: "pdf",
        title: `Imported PDF (${pages.length} pages)`,
        pageCount: pages.length,
        textPageCount: textPages.length,
        pages: truncatePages(textPages, sourceLimit),
        totalTextLength,
        truncated: totalTextLength > sourceLimit,
        note:
          totalTextLength > sourceLimit
            ? `Returned the first ${sourceLimit} extracted characters. Re-run with a higher maxChars value if more source context is needed.`
            : undefined,
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

function truncateText(
  text: string,
  limit: number,
): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  return { text: text.slice(0, limit), truncated: true };
}

function takeFromBudget(
  text: string,
  budget: { remaining: number },
): { text: string; truncated: boolean } {
  if (budget.remaining <= 0) {
    return { text: "", truncated: text.length > 0 };
  }
  if (text.length <= budget.remaining) {
    budget.remaining -= text.length;
    return { text, truncated: false };
  }
  const taken = text.slice(0, budget.remaining);
  budget.remaining = 0;
  return { text: taken, truncated: true };
}

function truncatePages(pages: { num: number; text: string }[], limit: number) {
  const budget = { remaining: limit };
  return pages
    .map((p) => {
      const truncated = takeFromBudget(p.text, budget);
      return {
        pageNum: p.num,
        text: truncated.text,
        textPreview: p.text.slice(0, 500),
        textLength: p.text.length,
        truncated: truncated.truncated,
      };
    })
    .filter((p) => p.text || p.textLength === 0);
}

function summarizeSections(sections: { heading: string; content: string }[]) {
  return sections.map((s) => {
    const plain = stripTags(s.content);
    return {
      heading: s.heading,
      textPreview: plain.slice(0, 500),
      textLength: plain.length,
    };
  });
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
