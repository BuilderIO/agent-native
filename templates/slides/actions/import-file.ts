import path from "path";

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { uploadFile } from "@agent-native/core/file-upload";
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
    "For Figma .fig files, requires Builder.io and starts Builder design-system indexing; the returned Builder job/design-system ids are the source of truth. " +
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

      // Designed slide PDFs (photo backgrounds, gradients, custom
      // typography) bake their visuals into vector/image page content with
      // no reliable text/shape structure to reconstruct, so importing into a
      // deck rasterizes each page instead of flattening it to generic bullet
      // text. Falls through to the text-only path below when the optional
      // canvas renderer isn't available in this runtime.
      if (importIntoDeck && canvasFactory) {
        if (!deckId) throw new Error("deckId is required to import into deck");
        return importPdfPagesAsFullBleedSlides({
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

async function importPdfPagesAsFullBleedSlides(args: {
  fileBuffer: Buffer;
  title: string;
  deckId: string;
  PDFParse: Awaited<ReturnType<typeof setupPdfParse>>["PDFParse"];
  canvasFactory: object;
}) {
  const { fileBuffer, title, deckId, PDFParse, canvasFactory } = args;
  const { buildFullBleedImageSlideHtml, convertSectionsToSlides } =
    await import("../server/handlers/import/html-converter.js");

  const pdf = new PDFParse({
    data: new Uint8Array(fileBuffer),
    CanvasFactory: canvasFactory,
  });
  let pages: { num: number; text: string }[];
  let imagesByPage: Map<
    number,
    { data: Uint8Array; width: number; height: number }
  >;
  try {
    pages = normalizePdfPages(await pdf.getText());
    // Reuse the page's own embedded photo rather than rasterizing the whole
    // page: headless canvas text rendering depends on the PDF's embedded
    // fonts resolving in this runtime, which is unreliable, so real
    // extracted text is drawn as HTML below instead of trusting the render.
    const imageResult = await pdf.getImage({
      imageBuffer: true,
      imageDataUrl: false,
    });
    imagesByPage = new Map();
    for (const page of imageResult.pages) {
      const largest = page.images.reduce<
        { data: Uint8Array; width: number; height: number } | undefined
      >((best, image) => {
        if (!best || image.width * image.height > best.width * best.height) {
          return { data: image.data, width: image.width, height: image.height };
        }
        return best;
      }, undefined);
      if (largest) imagesByPage.set(page.pageNumber, largest);
    }
  } finally {
    await pdf.destroy();
  }

  // Source decks (e.g. Instagram carousel exports) are commonly portrait or
  // square, not the deck editor's 16:9 default — match the canvas to the
  // first embedded photo's own proportions instead of stretching/cropping it.
  const firstImage = pages
    .map((page) => imagesByPage.get(page.num))
    .find((image): image is NonNullable<typeof image> => Boolean(image));
  const aspectRatio = firstImage
    ? nearestAspectRatio(firstImage.width, firstImage.height)
    : undefined;

  const ownerEmail = getRequestUserEmail();
  const slides = await Promise.all(
    pages.map(async (page) => {
      const lines = page.text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const backgroundImage = imagesByPage.get(page.num);

      if (!backgroundImage) {
        const [content] = convertSectionsToSlides([
          { heading: lines[0] ?? `Page ${page.num}`, content: page.text },
        ]);
        return {
          id: newSlideId(),
          content: content ?? '<div class="fmd-slide"></div>',
          layout: "content",
          notes: "",
        };
      }

      const uploadResult = await uploadFile({
        data: Buffer.from(backgroundImage.data),
        filename: `slide-import-${Date.now()}-p${page.num}.png`,
        mimeType: "image/png",
        ownerEmail: ownerEmail ?? undefined,
        recordAsset: false,
      });
      if (!uploadResult?.url) {
        throw new Error(
          "File storage is not configured. Connect Builder.io or another upload provider before importing PDF slides.",
        );
      }
      // pdf-parse breaks wrapped text across lines with no way to tell a
      // wrapped title from a heading followed by a body paragraph. Treat a
      // couple of short lines as one wrapped title (join them so the
      // sentence isn't cut off); three or more lines as a heading plus body
      // text, rendered with distinct sizes so they don't collapse into one
      // flat paragraph.
      const heading =
        lines.length > 2 ? lines[0] : lines.join(" ") || undefined;
      const subtitle = lines.length > 2 ? lines.slice(1).join(" ") : undefined;
      return {
        id: newSlideId(),
        content: buildFullBleedImageSlideHtml(
          uploadResult.url,
          heading,
          subtitle,
        ),
        layout: "full-image",
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

// EMF/WMF (Windows metafiles) and TIFF are valid PPTX embed formats but
// browsers can't render them in an <img> tag — uploading and linking one
// would just produce a broken image icon.
const PPTX_BROWSER_RENDERABLE_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/bmp",
]);

async function buildPptxSlide(
  slide: import("../server/handlers/import/pptx-parser.js").ParsedSlide,
  slideIndex: number,
  ownerEmail: string,
  themeFont: string | undefined,
): Promise<{
  slide: { id: string; content: string; layout: string; notes?: string };
  imageSkippedCount: number;
}> {
  const { convertToSlideHtml } =
    await import("../server/handlers/import/html-converter.js");
  const image = slide.images[0];
  const uploadable =
    image && PPTX_BROWSER_RENDERABLE_IMAGE_MIME_TYPES.has(image.mimeType)
      ? image
      : undefined;
  const imageUrl = uploadable
    ? await uploadFile({
        data: Buffer.from(uploadable.data),
        filename:
          "pptx-import-" +
          Date.now() +
          "-s" +
          slideIndex +
          "-" +
          uploadable.name,
        mimeType: uploadable.mimeType,
        ownerEmail,
        recordAsset: false,
      })
        .then((result) => result?.url)
        // A single slide's upload failing (network/API/rate-limit)
        // shouldn't abort the whole deck replacement — fall back to a
        // placeholder like an unsupported format would.
        .catch(() => undefined)
    : undefined;
  return {
    slide: {
      id: newSlideId(),
      content: convertToSlideHtml(slide, imageUrl, themeFont),
      layout: slide.layoutHint ?? "content",
      notes: slide.notes,
    },
    // Only the first image on a slide is ever uploaded, so every other
    // image on that slide is unconditionally dropped too — not just the
    // first one when it's unsupported.
    imageSkippedCount: Math.max(0, slide.images.length - (imageUrl ? 1 : 0)),
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
