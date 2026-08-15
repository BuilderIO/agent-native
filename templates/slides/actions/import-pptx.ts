import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import pLimit from "p-limit";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { notifyClients } from "../server/handlers/decks.js";
import { convertToSlideHtml } from "../server/handlers/import/html-converter.js";
import { uploadPptxSlideImages } from "../server/handlers/import/pptx-assets.js";
import {
  parsePptx,
  type ParsedElement,
  type ParsedImage,
  type ParsedPresentation,
} from "../server/handlers/import/pptx-parser.js";
import { buildSourceImportMetadata } from "../server/lib/source-import.js";
import {
  ASPECT_RATIOS,
  DEFAULT_ASPECT_RATIO,
  type AspectRatio,
} from "../shared/aspect-ratios.js";
import { getDeckUrl } from "./_app-url.js";
import { readUserUploadedFile } from "./_uploaded-files.js";

export interface ImportedImageFallback {
  slideIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  data: Uint8Array;
  mimeType: string;
  name: string;
  crop?: ParsedImage["crop"];
}

/** Add source-native image objects that a Google Slides PPTX export omitted. */
export function applyImageFallbacks(
  presentation: Awaited<ReturnType<typeof parsePptx>>,
  fallbacks: ImportedImageFallback[] = [],
): number {
  let added = 0;
  for (const [fallbackIndex, fallback] of fallbacks.entries()) {
    const slide = presentation.slides[fallback.slideIndex];
    if (!slide || fallback.width <= 0 || fallback.height <= 0) continue;

    const duplicate = slide.elements.some(
      (element) =>
        element.kind === "image" &&
        Math.abs(element.x - fallback.x) < 1000 &&
        Math.abs(element.y - fallback.y) < 1000 &&
        Math.abs(element.width - fallback.width) < 1000 &&
        Math.abs(element.height - fallback.height) < 1000,
    );
    if (duplicate) continue;

    const image: ParsedImage = {
      data: fallback.data,
      mimeType: fallback.mimeType,
      name: fallback.name,
      aspectRatio: fallback.width / fallback.height,
      ...(fallback.crop ? { crop: fallback.crop } : {}),
    };
    const element: ParsedElement = {
      id: `image-fallback-${fallback.slideIndex}-${fallbackIndex}`,
      name: fallback.name,
      kind: "image",
      x: fallback.x,
      y: fallback.y,
      width: fallback.width,
      height: fallback.height,
      image,
    };
    slide.images.push(image);
    slide.elements.push(element);
    added++;
  }
  return added;
}

export async function importPptxBufferToDeck(args: {
  fileBuffer: Buffer;
  title?: string;
  deckId?: string;
  designSystemId?: string | null;
  source?: string;
  imageFallbacks?: ImportedImageFallback[];
  parsedPresentation?: ParsedPresentation;
}): Promise<{
  id: string;
  title: string;
  slideCount: number;
  theme: Awaited<ReturnType<typeof parsePptx>>["theme"];
  imported: true;
  url: string;
  imagesSkipped?: number;
  tablesDegraded?: number;
}> {
  const {
    fileBuffer,
    title,
    deckId,
    designSystemId,
    source = "import-pptx",
    imageFallbacks,
    parsedPresentation,
  } = args;
  const presentation = parsedPresentation ?? (await parsePptx(fileBuffer));
  applyImageFallbacks(presentation, imageFallbacks);
  const deckTitle = title || presentation.title || "Imported Presentation";
  const ownerEmail = getRequestUserEmail();
  if (!ownerEmail) throw new Error("no authenticated user");
  const themeFont = presentation.theme?.fonts?.[0];

  // Check edit access before uploading any embedded images — uploads are
  // a side effect with real storage cost, so an unauthorized caller must
  // be rejected before that side effect happens, not after.
  if (deckId) {
    await assertAccess("deck", deckId, "editor");
  }

  // Convert each parsed slide to its positioned scene graph, uploading every
  // browser-renderable image so the imported deck keeps the source layering
  // and media instead of collapsing to a one-image approximation.
  const uploadLimit = pLimit(4);
  const results = await Promise.all(
    presentation.slides.map((parsedSlide, i) =>
      uploadLimit(async () => {
        const uploadedImages = await uploadPptxSlideImages({
          slide: parsedSlide,
          slideIndex: i,
          ownerEmail,
        });
        const html = convertToSlideHtml(
          parsedSlide,
          uploadedImages.urls,
          themeFont,
        );
        const id = `slide-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        return {
          slide: {
            id,
            content: html,
            layout: parsedSlide.layoutHint ?? "content",
            notes: parsedSlide.notes,
            ...(parsedSlide.transition
              ? { transition: parsedSlide.transition }
              : {}),
            ...(parsedSlide.splitByParagraph ? { splitByParagraph: true } : {}),
          },
          sourceText: parsedSlide.texts.map((text) => text.content).join("\n"),
          imageUrls: Object.values(uploadedImages.urls),
          imageSkippedCount: uploadedImages.imageSkippedCount,
          tablesDegraded: parsedSlide.tablesDegraded ?? 0,
        };
      }),
    ),
  );
  const slides = results.map((r) => r.slide);
  const imagesSkipped = results.reduce(
    (total, r) => total + r.imageSkippedCount,
    0,
  );
  const tablesDegraded = results.reduce(
    (total, r) => total + r.tablesDegraded,
    0,
  );
  if (imagesSkipped > 0) {
    throw new Error(
      `Source-faithful PPTX import could not preserve ${imagesSkipped} image(s). No deck was written. Retry with browser-renderable images or use a PDF export for page-faithful preservation.`,
    );
  }
  const sourceImport = buildSourceImportMetadata({
    format: "pptx",
    slides: results.map((result) => ({
      id: result.slide.id,
      text: result.sourceText,
      notes: result.slide.notes ?? "",
      imageUrls: result.imageUrls,
      editableText: true,
    })),
    imagesSkipped,
    tablesDegraded,
  });
  const aspectRatio = nearestAspectRatio(
    presentation.slides[0]?.widthEmu,
    presentation.slides[0]?.heightEmu,
  );

  const db = getDb();
  const now = new Date().toISOString();

  if (deckId) {
    const existing = await db
      .select()
      .from(schema.decks)
      .where(eq(schema.decks.id, deckId));

    if (!existing.length) {
      throw new Error(`Deck ${deckId} not found`);
    }

    const previousData = safeParseDeckData(existing[0].data);
    const data = {
      ...previousData,
      title: deckTitle,
      slides,
      ...(aspectRatio ? { aspectRatio } : {}),
      sourceImport,
      updatedAt: now,
    };
    await db
      .update(schema.decks)
      .set({
        title: deckTitle,
        data: JSON.stringify(data),
        ...(designSystemId !== undefined
          ? { designSystemId }
          : { designSystemId: existing[0].designSystemId }),
        updatedAt: now,
      })
      .where(eq(schema.decks.id, deckId));

    notifyClients(deckId);
    await writeAppState("refresh-signal", {
      ts: now,
      source,
    });

    return {
      id: deckId,
      title: deckTitle,
      slideCount: slides.length,
      theme: presentation.theme,
      imported: true,
      url: getDeckUrl(deckId),
      ...(imagesSkipped > 0 ? { imagesSkipped } : {}),
      ...(tablesDegraded > 0 ? { tablesDegraded } : {}),
    };
  }

  // Create new deck
  const id = `deck-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const data = {
    title: deckTitle,
    slides,
    ...(aspectRatio ? { aspectRatio } : {}),
    sourceImport,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(schema.decks).values({
    id,
    title: deckTitle,
    data: JSON.stringify(data),
    ownerEmail,
    orgId: getRequestOrgId(),
    designSystemId: designSystemId ?? undefined,
    createdAt: now,
    updatedAt: now,
  });

  notifyClients(id);
  await writeAppState("refresh-signal", { ts: now, source });

  return {
    id,
    title: deckTitle,
    slideCount: slides.length,
    theme: presentation.theme,
    imported: true,
    url: getDeckUrl(id),
    ...(imagesSkipped > 0 ? { imagesSkipped } : {}),
    ...(tablesDegraded > 0 ? { tablesDegraded } : {}),
  };
}

export default defineAction({
  description:
    "Import a PPTX file and create a slide deck from it. " +
    "Parses the PowerPoint file, extracts text and layout information, " +
    "converts each slide to the app's positioned HTML format, records source-preservation metadata, and creates or updates a deck. " +
    "If an embedded image cannot be preserved, the action fails before writing a partial deck. Returns the deck ID and slide count.",
  schema: z.object({
    filePath: z
      .string()
      .describe("Uploaded PPTX path or opaque hosted upload reference"),
    deckId: z
      .string()
      .optional()
      .describe(
        "If provided, import slides into this existing deck (replaces all slides)",
      ),
    designSystemId: z
      .string()
      .nullable()
      .optional()
      .describe("Optional design system to link when creating a new deck"),
    title: z
      .string()
      .optional()
      .describe(
        "Deck title — defaults to the title extracted from the presentation",
      ),
  }),
  run: async ({ filePath, deckId, title, designSystemId }) => {
    const { data: fileBuffer } = await readUserUploadedFile(filePath);
    return importPptxBufferToDeck({
      fileBuffer,
      deckId,
      title,
      designSystemId,
    });
  },
});

function nearestAspectRatio(
  width: number | undefined,
  height: number | undefined,
): AspectRatio | undefined {
  if (!width || !height || width <= 0 || height <= 0) return undefined;
  const target = width / height;
  let best: AspectRatio = DEFAULT_ASPECT_RATIO;
  let bestDiff = Infinity;
  for (const key of Object.keys(ASPECT_RATIOS) as AspectRatio[]) {
    const preset = ASPECT_RATIOS[key];
    const diff = Math.abs(preset.width / preset.height - target);
    if (diff < bestDiff) {
      best = key;
      bestDiff = diff;
    }
  }
  return best;
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
