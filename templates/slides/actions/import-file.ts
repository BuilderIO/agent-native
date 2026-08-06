import path from "path";

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { startBuilderDesignSystemIndex } from "@agent-native/core/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import pLimit from "p-limit";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { notifyClients } from "../server/handlers/decks.js";
import { uploadPptxSlideImages } from "../server/handlers/import/pptx-assets.js";
import { upsertBuilderProxyDesignSystem } from "../server/lib/builder-design-system-proxy.js";
import { setupPdfParse } from "../server/lib/pdf-parse-setup.js";
import {
  ASPECT_RATIOS,
  DEFAULT_ASPECT_RATIO,
  type AspectRatio,
} from "../shared/aspect-ratios.js";
import { readUserUploadedFile } from "./_uploaded-files.js";
import { withDeckLock } from "./patch-deck.js";

const DEFAULT_MAX_SOURCE_CHARS = 60_000;

export default defineAction({
  description:
    "Import a file (PPTX, DOCX, PDF, FIG) and extract content for creating slides or slide design systems. " +
    "For PPTX files, returns parsed slides with text and layout info ready for conversion. " +
    "For DOCX files, returns structured sections extracted from the document. " +
    "For PDF files, returns extracted text organized by page. " +
    "For Figma .fig files, requires Builder.io (free tier available) and starts Builder design-system indexing; the returned Builder job/design-system ids are the source of truth. " +
    "The agent can then use the extracted content to create a deck via create-deck or add-slide, or tell the user where Builder is indexing the design system.",
  schema: z.object({
    filePath: z
      .string()
      .describe("Uploaded file path or opaque hosted upload reference"),
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
        "If true, append slides converted from the file to the end of deckId's existing slides.",
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
    const uploaded = await readUserUploadedFile(filePath);
    const sourceLimit = maxChars ?? DEFAULT_MAX_SOURCE_CHARS;
    const fileBuffer = uploaded.data;
    const filename = uploaded.filename;

    // Detect format from extension if auto
    let detectedFormat = format;
    if (detectedFormat === "auto") {
      const ext = path.extname(filename).toLowerCase();
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
          "Figma .fig imports start Builder design-system indexing, not slide replacements. Re-run without importIntoDeck.",
        );
      }
      const title = titleFromPath(filename);
      const result = await startBuilderDesignSystemIndex({
        projectName: title,
        files: [
          {
            name: path.basename(filename),
            data: fileBuffer,
            mimeType: "application/octet-stream",
          },
        ],
      });
      const ownerEmail = getRequestUserEmail();
      if (!ownerEmail) throw new Error("no authenticated user");
      const proxy = await upsertBuilderProxyDesignSystem({
        result,
        ownerEmail,
        orgId: getRequestOrgId(),
        projectName: title,
        sourceKind: "figma",
      });
      return {
        format: "fig",
        title,
        source: "builder",
        projectId: result.projectId,
        jobId: result.jobId,
        designSystemId: result.designSystemId,
        localDesignSystemId: proxy.localDesignSystemId,
        builderUrl: result.builderUrl,
        status: result.status,
        deckId,
        instructions: proxy.instructions,
      };
    }

    if (detectedFormat === "pptx") {
      const { parsePptx } =
        await import("../server/handlers/import/pptx-parser.js");
      const presentation = await parsePptx(fileBuffer);
      const title = presentation.title || titleFromPath(filename);

      if (importIntoDeck) {
        if (!deckId) throw new Error("deckId is required to import into deck");
        await assertAccess("deck", deckId, "editor");
        const pptxOwnerEmail = getRequestUserEmail();
        if (!pptxOwnerEmail) throw new Error("no authenticated user");
        const pptxThemeFont = presentation.theme?.fonts?.[0];
        const uploadLimit = pLimit(4);
        const pptxResults = await Promise.all(
          presentation.slides.map((slide, i) =>
            uploadLimit(() =>
              buildPptxSlide(slide, i, pptxOwnerEmail, pptxThemeFont),
            ),
          ),
        );
        const slides = pptxResults.map((r) => r.slide);
        const imagesSkipped = pptxResults.reduce(
          (total, r) => total + r.imageSkippedCount,
          0,
        );
        await appendDeckSlides(deckId, title, slides, "import-file:pptx");
        return {
          format: "pptx",
          title,
          slideCount: slides.length,
          theme: presentation.theme,
          deckId,
          imported: true,
          ...(imagesSkipped > 0 ? { imagesSkipped } : {}),
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
          transition: slide.transition,
          splitByParagraph: slide.splitByParagraph,
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
      const title = doc.title || titleFromPath(filename);

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
        await appendDeckSlides(deckId, title, slides, "import-file:docx");
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
      const { PDFParse, canvasFactory } = await setupPdfParse();
      const title = titleFromPath(filename);

      // Reconstruct each page's real layout — positioned text blocks at
      // their actual sizes plus every embedded image at its actual
      // placement — instead of flattening the page to one guessed
      // background photo and a canned text template. Image placement needs
      // the optional canvas renderer; text positioning does not, so this
      // still beats the old bullet-text fallback even when canvasFactory is
      // unavailable in this runtime.
      if (importIntoDeck) {
        if (!deckId) throw new Error("deckId is required to import into deck");
        return importPdfPagesWithFidelity({
          fileBuffer,
          title,
          deckId,
          PDFParse,
          canvasFactory,
        });
      }

      const { convertSectionsToSlides } =
        await import("../server/handlers/import/html-converter.js");
      const pdf = new PDFParse({
        data: new Uint8Array(fileBuffer),
        CanvasFactory: canvasFactory,
      });
      const result = await pdf.getText().finally(() => pdf.destroy());
      const pages = normalizePdfPages(result);
      const textPages = pages.filter((p) => p.text.trim());

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
        await appendDeckSlides(deckId, title, slides, "import-file:pdf");
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

/** Closest configured deck aspect ratio to a source image's own dimensions. */
function nearestAspectRatio(width: number, height: number): AspectRatio {
  const target = width / height;
  let best: AspectRatio = DEFAULT_ASPECT_RATIO;
  let bestDiff = Infinity;
  for (const key of Object.keys(ASPECT_RATIOS) as AspectRatio[]) {
    const preset = ASPECT_RATIOS[key];
    const diff = Math.abs(preset.width / preset.height - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = key;
    }
  }
  return best;
}

async function importPdfPagesWithFidelity(args: {
  fileBuffer: Buffer;
  title: string;
  deckId: string;
  PDFParse: Awaited<ReturnType<typeof setupPdfParse>>["PDFParse"];
  canvasFactory: object | undefined;
}) {
  const { fileBuffer, title, deckId, PDFParse, canvasFactory } = args;
  const { convertToSlideHtml, convertSectionsToSlides } =
    await import("../server/handlers/import/html-converter.js");
  const { parsePdfFidelity } =
    await import("../server/handlers/import/pdf-fidelity-parser.js");

  const pdf = new PDFParse({
    data: new Uint8Array(fileBuffer),
    CanvasFactory: canvasFactory,
  });
  let pages: { num: number; text: string }[];
  let fidelityPages: Awaited<ReturnType<typeof parsePdfFidelity>>;
  try {
    pages = normalizePdfPages(await pdf.getText());
    // Image placement needs the optional canvas renderer to decode pixel
    // data; skip it (text still gets real positions/sizes) when the native
    // canvas binding isn't available in this runtime.
    const imageResult = canvasFactory
      ? await pdf
          .getImage({
            imageBuffer: true,
            imageDataUrl: false,
            imageThreshold: 0,
          })
          .catch((err) => {
            console.warn(
              "[import-file] PDF image extraction failed, importing text-only fidelity:",
              err instanceof Error ? err.message : String(err),
            );
            return undefined;
          })
      : undefined;

    // `pdf-parse` memoizes the loaded pdfjs document behind `load()` (a
    // TS-only `private` method — a real, callable runtime property).
    // Reaching into it reuses the exact document `getText`/`getImage` above
    // already parsed instead of parsing the file a second time.
    const doc = await (
      pdf as unknown as {
        load(): Promise<
          import("pdfjs-dist/legacy/build/pdf.mjs").PDFDocumentProxy
        >;
      }
    ).load();
    // coercion-ok: undefined here means either canvasFactory was absent or
    // getImage() already failed and logged a warning above — text-only
    // fidelity is the intended degrade, not a swallowed failure.
    fidelityPages = await parsePdfFidelity(doc, imageResult?.pages ?? []);
  } finally {
    await pdf.destroy();
  }

  // Source decks (e.g. Instagram carousel exports) are commonly portrait or
  // square, not the deck editor's 16:9 default — match the canvas to the
  // PDF's own real page proportions instead of stretching/cropping it.
  const firstSizedPage = fidelityPages.find((p) => p.widthEmu > 0);
  const aspectRatio = firstSizedPage
    ? nearestAspectRatio(firstSizedPage.widthEmu, firstSizedPage.heightEmu)
    : undefined;

  const ownerEmail = getRequestUserEmail();
  if (!ownerEmail) throw new Error("no authenticated user");

  const slides = await Promise.all(
    pages.map(async (page, index) => {
      const fidelity = fidelityPages.find((p) => p.pageNumber === page.num);

      if (!fidelity || fidelity.elements.length === 0) {
        // Fidelity parsing failed or found nothing placeable on this page
        // (e.g. a fully blank page) — fall back to plain extracted text
        // instead of producing a silently blank slide.
        const firstLine = page.text.split(/\r?\n/)[0]?.trim();
        const [content] = convertSectionsToSlides([
          { heading: firstLine || `Page ${page.num}`, content: page.text },
        ]);
        return {
          id: newSlideId(),
          content: content ?? '<div class="fmd-slide"></div>',
          layout: "content",
          notes: page.text,
        };
      }

      const slideForUpload = {
        texts: [],
        images: [],
        elements: fidelity.elements,
      };
      const uploaded = await uploadPptxSlideImages({
        slide: slideForUpload,
        slideIndex: index,
        ownerEmail,
      });
      const content = convertToSlideHtml(
        {
          texts: [],
          images: [],
          elements: fidelity.elements,
          widthEmu: fidelity.widthEmu,
          heightEmu: fidelity.heightEmu,
          backgroundColor: "#ffffff", // guard:allow-raw-color - a PDF page's own paper background, not a design-system token
        },
        uploaded.urls,
      );

      return {
        id: newSlideId(),
        content,
        layout: "content",
        notes: page.text,
      };
    }),
  );

  await appendDeckSlides(deckId, title, slides, "import-file:pdf", aspectRatio);

  return {
    format: "pdf",
    title,
    pageCount: slides.length,
    slideCount: slides.length,
    aspectRatio,
    deckId,
    imported: true,
  };
}

function newSlideId(): string {
  return `slide-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function buildPptxSlide(
  slide: import("../server/handlers/import/pptx-parser.js").ParsedSlide,
  slideIndex: number,
  ownerEmail: string,
  themeFont: string | undefined,
): Promise<{
  slide: {
    id: string;
    content: string;
    layout: string;
    notes?: string;
    transition?: "instant" | "none" | "fade" | "slide" | "zoom";
    splitByParagraph?: boolean;
  };
  imageSkippedCount: number;
}> {
  const { convertToSlideHtml } =
    await import("../server/handlers/import/html-converter.js");
  const uploadedImages = await uploadPptxSlideImages({
    slide,
    slideIndex,
    ownerEmail,
  });
  return {
    slide: {
      id: newSlideId(),
      content: convertToSlideHtml(slide, uploadedImages.urls, themeFont),
      layout: slide.layoutHint ?? "content",
      notes: slide.notes,
      ...(slide.transition ? { transition: slide.transition } : {}),
      ...(slide.splitByParagraph ? { splitByParagraph: true } : {}),
    },
    imageSkippedCount: uploadedImages.imageSkippedCount,
  };
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

async function appendDeckSlides(
  deckId: string,
  title: string,
  slides: Array<{
    id: string;
    content: string;
    layout: string;
    notes?: string;
    transition?: "instant" | "none" | "fade" | "slide" | "zoom";
    splitByParagraph?: boolean;
  }>,
  source: string,
  aspectRatio?: AspectRatio,
) {
  await assertAccess("deck", deckId, "editor");

  // Read-modify-write under the shared per-deck lock used by patch-deck /
  // add-slide / update-slide. Without it, an import running concurrently
  // with another import or an editor/agent slide mutation on the same deck
  // could read stale data and clobber the other write when both save the
  // whole decks.data blob back.
  const now = await withDeckLock(deckId, async () => {
    const db = getDb();
    const existing = await db
      .select()
      .from(schema.decks)
      .where(eq(schema.decks.id, deckId))
      .limit(1);

    if (!existing.length) {
      throw new Error(`Deck ${deckId} not found`);
    }

    const writeNow = new Date().toISOString();
    const previousData = safeParseDeckData(existing[0].data);
    const previousSlides = Array.isArray(
      (previousData as { slides?: unknown }).slides,
    )
      ? ((previousData as { slides: unknown[] }).slides as typeof slides)
      : [];
    // Appending onto an existing deck keeps that deck's own title and canvas
    // shape — the imported file's title/aspect ratio only apply when the deck
    // had no slides yet, otherwise resizing the canvas mid-deck would distort
    // every slide already on it.
    const hadExistingSlides = previousSlides.length > 0;
    const nextTitle = hadExistingSlides ? (existing[0].title ?? title) : title;
    const data = {
      ...previousData,
      title: nextTitle,
      slides: [...previousSlides, ...slides],
      ...(!hadExistingSlides && aspectRatio ? { aspectRatio } : {}),
      updatedAt: writeNow,
    };

    await db
      .update(schema.decks)
      .set({
        title: nextTitle,
        data: JSON.stringify(data),
        updatedAt: writeNow,
      })
      .where(eq(schema.decks.id, deckId));

    return writeNow;
  });

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
