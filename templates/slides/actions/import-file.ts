import path from "path";

import { defineAction } from "@agent-native/core/action";
import { MAX_TOOL_RESULT_IMAGE_BASE64_CHARS } from "@agent-native/core/agent/tool-result-images";
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
import type { PdfStyleDigest } from "../server/handlers/import/pdf-style-digest.js";
import {
  assertPptxImagesRenderable,
  uploadPptxSlideImages,
} from "../server/handlers/import/pptx-assets.js";
import { upsertBuilderProxyDesignSystem } from "../server/lib/builder-design-system-proxy.js";
import { assertDesignSystemWorkflowsEnabled } from "../server/lib/design-system-workflows.js";
import { setupPdfParse } from "../server/lib/pdf-parse-setup.js";
import {
  buildSourceImportMetadata,
  mergeSourceImportMetadata,
  sourceImportForDeck,
  type SourceImportSlideSnapshot,
} from "../server/lib/source-import.js";
import {
  ASPECT_RATIOS,
  ASPECT_RATIO_VALUES,
  DEFAULT_ASPECT_RATIO,
  type AspectRatio,
} from "../shared/aspect-ratios.js";
import {
  DEFAULT_IMPORTED_DECK_TITLE,
  isOpaqueDeckTitle,
  resolveImportedDeckTitle,
} from "../shared/deck-title.js";
import type { SlidesPdfSidecar } from "../shared/pdf-sidecar.js";
import {
  assertDeckWriteApplied,
  deckRevisionWhere,
  nextDeckRevision,
} from "./_deck-write.js";
import { readUserUploadedFile } from "./_uploaded-files.js";
import { withDeckLock } from "./patch-deck.js";

const DEFAULT_MAX_SOURCE_CHARS = 60_000;

function rasterImageMediaType(
  filename: string,
): "image/jpeg" | "image/png" | "image/gif" | "image/webp" | null {
  switch (path.extname(filename).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    default:
      return null;
  }
}

export default defineAction({
  description:
    "Import a file (PPTX, DOCX, PDF, FIG, or raster image) and extract content for creating slides or slide design systems. " +
    "For PPTX files, returns parsed slides with text and layout info ready for conversion, or writes positioned source-preserving slides when importIntoDeck is true. " +
    "For DOCX files, returns structured sections extracted from the document. " +
    "For PDF files, returns extracted text organized by page, or editable slides when importIntoDeck is true — a PDF this app exported restores its original slides, and any other PDF is rebuilt as positioned text boxes and images. " +
    "For Figma .fig files, requires Builder.io (free tier available) and starts Builder design-system indexing; the returned Builder job/design-system ids are the source of truth. " +
    "The agent can then use the extracted content to create a deck via create-deck or add-slide, or tell the user where Builder is indexing the design system.",
  schema: z.object({
    filePath: z
      .string()
      .describe("Uploaded file path or opaque hosted upload reference"),
    format: z
      .enum(["pptx", "docx", "pdf", "fig", "image", "auto"])
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
        "If true, append slides to deckId. PDF pages become editable slides — original layers when the PDF came from this app, otherwise positioned text boxes and images reconstructed from the page. Use the default false to read a file's text without writing slides.",
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

    let detectedFormat = format;
    if (detectedFormat === "auto") {
      const ext = path.extname(filename).toLowerCase();
      if (ext === ".pptx") detectedFormat = "pptx";
      else if (ext === ".docx") detectedFormat = "docx";
      else if (ext === ".pdf") detectedFormat = "pdf";
      else if (ext === ".fig") detectedFormat = "fig";
      else if (rasterImageMediaType(filename)) detectedFormat = "image";
      else {
        throw new Error(
          `Cannot detect format from extension "${ext}". Supported: .pptx, .docx, .pdf, .fig, .jpg, .png, .gif, .webp`,
        );
      }
    }

    if (detectedFormat === "image") {
      if (importIntoDeck) {
        throw new Error(
          "Raster image imports are visual references, not slide imports. Use update-slide or add-slide to place the image after inspecting it.",
        );
      }
      const mediaType = rasterImageMediaType(filename);
      if (!mediaType) {
        throw new Error(
          "Vision image imports support only JPEG, PNG, GIF, and WebP files.",
        );
      }
      const imageData = fileBuffer.toString("base64");
      if (imageData.length > MAX_TOOL_RESULT_IMAGE_BASE64_CHARS) {
        throw new Error(
          `Raster image "${filename}" exceeds the ${MAX_TOOL_RESULT_IMAGE_BASE64_CHARS.toLocaleString()}-character vision tool limit. Upload a smaller image and retry.`,
        );
      }
      return {
        format: "image",
        filename,
        contentType: mediaType,
        byteLength: fileBuffer.length,
        deckId,
        _agentImages: [
          {
            data: imageData,
            mediaType,
            label: filename,
          },
        ],
      };
    }

    if (detectedFormat === "fig") {
      await assertDesignSystemWorkflowsEnabled();
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
      const fallbackTitle = titleFromPath(filename);
      const title = presentation.title || "";

      if (importIntoDeck) {
        if (!deckId) throw new Error("deckId is required to import into deck");
        await assertAccess("deck", deckId, "editor");
        const pptxOwnerEmail = getRequestUserEmail();
        if (!pptxOwnerEmail) throw new Error("no authenticated user");
        assertPptxImagesRenderable(presentation.slides);
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
        const tablesDegraded = presentation.slides.reduce(
          (total, s) => total + (s.tablesDegraded ?? 0),
          0,
        );
        const sourceImport = buildSourceImportMetadata({
          format: "pptx",
          slides: pptxResults.map((result) => ({
            id: result.slide.id,
            text: result.sourceText,
            notes: result.slide.notes ?? "",
            imageUrls: result.imageUrls,
            editableText: true,
          })),
          imagesSkipped,
          tablesDegraded,
        });
        if (imagesSkipped > 0) {
          throw new Error(
            `Source-faithful PPTX import could not preserve ${imagesSkipped} image(s). No slides were written. Retry with browser-renderable images or use a PDF export for page-faithful preservation.`,
          );
        }
        const aspectRatio =
          presentation.slides[0]?.widthEmu && presentation.slides[0]?.heightEmu
            ? nearestAspectRatio(
                presentation.slides[0].widthEmu,
                presentation.slides[0].heightEmu,
              )
            : undefined;
        const importedTitle = await appendDeckSlides(
          deckId,
          title,
          slides,
          "import-file:pptx",
          aspectRatio,
          sourceImport,
          pptxResults[0]?.sourceText,
          fallbackTitle,
          presentation.theme,
        );
        return {
          format: "pptx",
          title: importedTitle,
          slideCount: slides.length,
          theme: presentation.theme,
          deckId,
          imported: true,
          ...(imagesSkipped > 0 ? { imagesSkipped } : {}),
          ...(tablesDegraded > 0 ? { tablesDegraded } : {}),
        };
      }

      return {
        format: "pptx",
        title: resolveImportedDeckTitle(
          title,
          presentation.slides[0]?.texts.map((text) => text.content).join("\n"),
          fallbackTitle,
        ),
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
      const fallbackTitle = titleFromPath(filename);
      const title = doc.title || "";

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
        const importedTitle = await appendDeckSlides(
          deckId,
          title,
          slides,
          "import-file:docx",
          undefined,
          undefined,
          doc.text,
          fallbackTitle,
        );
        return {
          format: "docx",
          title: importedTitle,
          sectionCount: doc.sections.length,
          slideCount: slides.length,
          textLength: doc.text.length,
          deckId,
          imported: true,
        };
      }

      return {
        format: "docx",
        title: resolveImportedDeckTitle(title, doc.text, fallbackTitle),
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

      if (importIntoDeck) {
        if (!deckId) throw new Error("deckId is required to import into deck");
        return importPdfPagesWithFidelity({
          fileBuffer,
          title: "",
          deckId,
          PDFParse,
          canvasFactory,
          fallbackTitle: title,
        });
      }

      const pdf = new PDFParse({
        data: new Uint8Array(fileBuffer),
        CanvasFactory: canvasFactory,
      });
      let pages: { num: number; text: string }[];
      let style: PdfStyleReadResult;
      try {
        pages = normalizePdfPages(await pdf.getText());
        style = await readPdfStyleDigest(pdf);
      } finally {
        await pdf.destroy();
      }
      const textPages = pages.filter((p) => p.text.trim());

      if (textPages.length === 0) {
        throw new Error(
          "No importable text found in this PDF. Scanned PDFs need OCR first.",
        );
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
        ...style,
        deckId,
      };
    }

    throw new Error(
      `Unsupported format: ${typeof detectedFormat === "string" ? detectedFormat : (JSON.stringify(detectedFormat) ?? "unknown")}`,
    );
  },
});

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

async function importPdfFromSidecar(args: {
  sidecar: SlidesPdfSidecar;
  fallbackTitle: string;
  deckId: string;
}) {
  const { sidecar, fallbackTitle, deckId } = args;

  const slides = sidecar.slides.map((slide) => ({
    ...slide,
    id: newSlideId(),
    layout: slide.layout ?? "content",
  }));

  const aspectRatio = ASPECT_RATIO_VALUES.includes(
    sidecar.aspectRatio as AspectRatio,
  )
    ? (sidecar.aspectRatio as AspectRatio)
    : undefined;

  const importedTitle = await appendDeckSlides(
    deckId,
    sidecar.title?.trim() || "",
    slides,
    "import-file:pdf-sidecar",
    aspectRatio,
    undefined,
    undefined,
    fallbackTitle,
  );

  return {
    format: "pdf",
    title: importedTitle,
    pageCount: slides.length,
    slideCount: slides.length,
    aspectRatio,
    deckId,
    imported: true,
    restoredFromExport: true,
  };
}

async function importPdfPagesWithFidelity(args: {
  fileBuffer: Buffer;
  title: string;
  deckId: string;
  fallbackTitle: string;
  PDFParse: Awaited<ReturnType<typeof setupPdfParse>>["PDFParse"];
  canvasFactory: object | undefined;
}) {
  const { fileBuffer, title, deckId, fallbackTitle, PDFParse, canvasFactory } =
    args;
  const { convertToSlideHtml, convertSectionsToSlides } =
    await import("../server/handlers/import/html-converter.js");
  const { parsePdfFidelity } =
    await import("../server/handlers/import/pdf-fidelity-parser.js");
  const { readSlidesPdfSidecar } =
    await import("../server/handlers/import/pdf-sidecar-reader.js");

  const pdf = new PDFParse({
    data: new Uint8Array(fileBuffer),
    CanvasFactory: canvasFactory,
  });
  const loadDocument = () => loadPdfDocument(pdf);

  let pages: { num: number; text: string }[];
  let pageCount = 0;
  let fidelityPages: Awaited<ReturnType<typeof parsePdfFidelity>>;
  let sidecarWarning: string | undefined;
  try {
    const sidecar = await readSlidesPdfSidecar(await loadDocument());
    if (sidecar.status === "unreadable") {
      sidecarWarning = `This PDF was exported from Slides, but its embedded deck source could not be used (${sidecar.reason}). The slides below were rebuilt from the page content instead, so they may differ from the original deck.`;
      console.warn(`[import-file] ${sidecarWarning}`);
    }
    if (sidecar.status === "found") {
      return await importPdfFromSidecar({
        sidecar: sidecar.sidecar,
        fallbackTitle,
        deckId,
      });
    }

    pages = normalizePdfPages(await pdf.getText());
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

    const doc = await loadDocument();
    pageCount = doc.numPages;
    // coercion-ok: undefined here means either canvasFactory was absent or
    fidelityPages = await parsePdfFidelity(doc, imageResult?.pages ?? []);
  } finally {
    await pdf.destroy();
  }

  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error("The PDF renderer returned an invalid page count.");
  }
  if (
    pages.length !== pageCount ||
    pages.some((page, index) => page.num !== index + 1)
  ) {
    const textByPage = new Map(pages.map((page) => [page.num, page.text]));
    pages = Array.from({ length: pageCount }, (_, index) => ({
      num: index + 1,
      text: textByPage.get(index + 1) ?? "",
    }));
  }
  if (pages.length === 0) {
    throw new Error("The PDF renderer returned no importable pages.");
  }

  const hasRecoverableContent = pages.some((page) => {
    const fidelity = fidelityPages.find((p) => p.pageNumber === page.num);
    return page.text.trim().length > 0 || (fidelity?.elements.length ?? 0) > 0;
  });
  if (!hasRecoverableContent) {
    throw new Error(
      "No importable text or images found in this PDF. Scanned PDFs need OCR first.",
    );
  }

  const firstSizedPage = fidelityPages.find((p) => p.widthEmu > 0);
  const aspectRatio = firstSizedPage
    ? nearestAspectRatio(firstSizedPage.widthEmu, firstSizedPage.heightEmu)
    : undefined;

  const ownerEmail = getRequestUserEmail();
  if (!ownerEmail) throw new Error("no authenticated user");

  const uploadLimit = pLimit(4);
  const imported = await Promise.all(
    pages.map((page, index) =>
      uploadLimit(async () => {
        const fidelity = fidelityPages.find((p) => p.pageNumber === page.num);

        if (!fidelity || fidelity.elements.length === 0) {
          const firstLine = page.text.split(/\r?\n/)[0]?.trim();
          const [content] = convertSectionsToSlides([
            { heading: firstLine || `Page ${page.num}`, content: page.text },
          ]);
          const id = newSlideId();
          return {
            slide: {
              id,
              content: content ?? '<div class="fmd-slide"></div>',
              layout: "content",
              notes: page.text,
            },
            snapshot: {
              id,
              text: page.text,
              notes: page.text,
              imageUrls: [],
              editableText: true,
            } satisfies SourceImportSlideSnapshot,
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
            backgroundColor: fidelity.backgroundColor ?? "#ffffff", // guard:allow-raw-color - fallback plain-paper background, not a design-system token
          },
          uploaded.urls,
        );

        const id = newSlideId();
        return {
          slide: {
            id,
            content,
            layout: "content",
            notes: page.text,
          },
          snapshot: {
            id,
            text: page.text,
            notes: page.text,
            imageUrls: Object.values(uploaded.urls),
            editableText: true,
          } satisfies SourceImportSlideSnapshot,
        };
      }),
    ),
  );
  const slides = imported.map((entry) => entry.slide);
  const imagesSkipped = fidelityPages.reduce(
    (total, page) => total + page.imagesSkipped,
    0,
  );
  const sourceImport = buildSourceImportMetadata({
    format: "pdf",
    slides: imported.map((entry) => entry.snapshot),
    imagesSkipped,
  });
  const firstPageText = imported[0]?.snapshot.text ?? "";
  const titleSource = hasLikelyPdfTitleEncodingCorruption(firstPageText)
    ? ""
    : firstPageText;

  const importedTitle = await appendDeckSlides(
    deckId,
    title,
    slides,
    "import-file:pdf",
    aspectRatio,
    sourceImport,
    titleSource,
    fallbackTitle,
  );

  return {
    format: "pdf",
    title: importedTitle,
    pageCount: slides.length,
    slideCount: slides.length,
    aspectRatio,
    deckId,
    imported: true,
    ...(imagesSkipped > 0 ? { imagesSkipped } : {}),
    ...(sidecarWarning ? { warning: sidecarWarning } : {}),
  };
}

function hasLikelyPdfTitleEncodingCorruption(value: string): boolean {
  const firstLine = value.split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (!firstLine) return false;
  if (/[\uFFFD\uE000-\uF8FF]/u.test(firstLine)) return true;
  if (/(?:Ã[\u0080-\u00FF]|Â[\u0080-\u00FF]|â€|ðŸ)/u.test(firstLine)) {
    return true;
  }

  const letters = Array.from(firstLine).filter((character) =>
    /\p{L}/u.test(character),
  );
  const extendedLatin = new Set(
    letters.filter((character) => /[\u00C0-\u024F]/u.test(character)),
  );
  return (
    letters.length <= 4 &&
    letters.some((character) => /[A-Za-z]/.test(character)) &&
    extendedLatin.size >= 2 &&
    /[^\p{L}\p{N}\s]$/u.test(firstLine)
  );
}

type LoadablePdf = {
  load(): Promise<import("pdfjs-dist/legacy/build/pdf.mjs").PDFDocumentProxy>;
};

function loadPdfDocument(pdf: unknown) {
  return (pdf as LoadablePdf).load();
}

interface PdfStyleReadResult {
  styleDigest: PdfStyleDigest | null;
  styleDigestUnavailableReason?: string;
}

async function readPdfStyleDigest(pdf: unknown): Promise<PdfStyleReadResult> {
  try {
    const { parsePdfFidelity } =
      await import("../server/handlers/import/pdf-fidelity-parser.js");
    const { buildPdfStyleDigest } =
      await import("../server/handlers/import/pdf-style-digest.js");
    const fidelityPages = await parsePdfFidelity(
      await loadPdfDocument(pdf),
      [],
    );
    const styleDigest = buildPdfStyleDigest(fidelityPages);
    if (!styleDigest) {
      return {
        styleDigest: null,
        styleDigestUnavailableReason:
          "the PDF renderer returned no pages to analyze",
      };
    }
    return { styleDigest };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn("[import-file] PDF style digest unavailable:", reason);
    return { styleDigest: null, styleDigestUnavailableReason: reason };
  }
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
  sourceText: string;
  imageUrls: string[];
}> {
  const { convertToSlideHtml } =
    await import("../server/handlers/import/html-converter.js");
  const uploadedImages = await uploadPptxSlideImages({
    slide,
    slideIndex,
    ownerEmail,
  });
  const id = newSlideId();
  return {
    slide: {
      id,
      content: convertToSlideHtml(slide, uploadedImages.urls, themeFont),
      layout: slide.layoutHint ?? "content",
      notes: slide.notes,
      ...(slide.transition ? { transition: slide.transition } : {}),
      ...(slide.splitByParagraph ? { splitByParagraph: true } : {}),
    },
    imageSkippedCount: uploadedImages.imageSkippedCount,
    sourceText: slide.texts.map((text) => text.content).join("\n"),
    imageUrls: Object.values(uploadedImages.urls),
  };
}

function titleFromPath(filePath: string): string {
  const base = path.basename(filePath, path.extname(filePath)).trim();
  return base && !isOpaqueDeckTitle(base) ? base : DEFAULT_IMPORTED_DECK_TITLE;
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
  sourceImport?: ReturnType<typeof buildSourceImportMetadata>,
  titleSource?: unknown,
  fallbackTitle?: unknown,
  theme?: import("../server/handlers/import/pptx-parser.js").ParsedPresentation["theme"],
): Promise<string> {
  await assertAccess("deck", deckId, "editor");

  let resolvedTitle = title;
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

    const writeNow = nextDeckRevision(existing[0].updatedAt);
    const previousData = safeParseDeckData(existing[0].data);
    const previousSlides = Array.isArray(
      (previousData as { slides?: unknown }).slides,
    )
      ? ((previousData as { slides: unknown[] }).slides as typeof slides)
      : [];
    const hadExistingSlides = previousSlides.length > 0;
    const nextTitle = hadExistingSlides
      ? resolveImportedDeckTitle(
          existing[0].title ?? title,
          titleSource ?? slides[0]?.content,
          fallbackTitle ?? title,
        )
      : resolveImportedDeckTitle(
          title,
          titleSource ?? slides[0]?.content,
          fallbackTitle,
        );
    resolvedTitle = nextTitle;
    const nextSourceImport = sourceImport
      ? mergeSourceImportMetadata(
          sourceImportForDeck(previousData.sourceImport),
          sourceImport,
        )
      : sourceImportForDeck(previousData.sourceImport);
    const data = {
      ...previousData,
      title: nextTitle,
      slides: [...previousSlides, ...slides],
      ...(!hadExistingSlides && aspectRatio ? { aspectRatio } : {}),
      ...(!hadExistingSlides && theme ? { theme } : {}),
      ...(nextSourceImport ? { sourceImport: nextSourceImport } : {}),
      updatedAt: writeNow,
    };

    const updateResult = await db
      .update(schema.decks)
      .set({
        title: nextTitle,
        data: JSON.stringify(data),
        updatedAt: writeNow,
      })
      .where(deckRevisionWhere(schema.decks, deckId, existing[0].updatedAt));
    assertDeckWriteApplied(updateResult, deckId, "file import");

    return writeNow;
  });

  await notifyClients(deckId);
  await writeAppState("refresh-signal", { ts: now, source });
  return resolvedTitle;
}

function safeParseDeckData(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "The target deck contains invalid JSON; refusing to overwrite it.",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "The target deck data is invalid; refusing to overwrite it.",
    );
  }
  return parsed as Record<string, unknown>;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}
