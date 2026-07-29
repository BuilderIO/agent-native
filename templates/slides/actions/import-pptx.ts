import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { uploadFile } from "@agent-native/core/file-upload";
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
import {
  parsePptx,
  type ParsedSlide,
} from "../server/handlers/import/pptx-parser.js";
import { getDeckUrl } from "./_app-url.js";
import { readUserUploadedFile } from "./_uploaded-files.js";

// EMF/WMF (Windows metafiles) and TIFF are valid PPTX embed formats but
// browsers can't render them in an <img> tag — uploading and linking one
// would just produce a broken image icon.
const BROWSER_RENDERABLE_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/bmp",
]);

async function uploadFirstSlideImage(
  slide: ParsedSlide,
  slideIndex: number,
  ownerEmail: string,
): Promise<string | undefined> {
  const image = slide.images[0];
  if (!image || !BROWSER_RENDERABLE_IMAGE_MIME_TYPES.has(image.mimeType)) {
    return undefined;
  }
  const filename =
    "pptx-import-" + Date.now() + "-s" + slideIndex + "-" + image.name;
  try {
    const result = await uploadFile({
      data: Buffer.from(image.data),
      filename,
      mimeType: image.mimeType,
      ownerEmail,
      recordAsset: false,
    });
    return result?.url;
  } catch {
    // A single slide's upload failing (network/API/rate-limit) shouldn't
    // abort the whole deck import — that slide's text still imports fine,
    // it just falls back to a placeholder like an unsupported format would.
    return undefined;
  }
}

export default defineAction({
  description:
    "Import a PPTX file and create a slide deck from it. " +
    "Parses the PowerPoint file, extracts text and layout information, " +
    "converts each slide to the app's HTML format, and creates or updates a deck. " +
    "Returns the deck ID and slide count.",
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
    title: z
      .string()
      .optional()
      .describe(
        "Deck title — defaults to the title extracted from the presentation",
      ),
  }),
  run: async ({ filePath, deckId, title }) => {
    const { data: fileBuffer } = await readUserUploadedFile(filePath);
    const presentation = await parsePptx(fileBuffer);

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

    // Convert each parsed slide to our HTML format, uploading the first
    // embedded image (if any) so it renders as a real image instead of a
    // text placeholder. Concurrency is capped so a large deck doesn't fire
    // one outbound upload per slide at once. An image can end up unused
    // (unsupported format, or upload storage not configured) without
    // failing the whole import — the slide's text still imports fine — but
    // that shouldn't be a silent, invisible degradation, so it's counted
    // and returned to the caller.
    const uploadLimit = pLimit(4);
    const results = await Promise.all(
      presentation.slides.map((parsedSlide, i) =>
        uploadLimit(async () => {
          const imageUrl = await uploadFirstSlideImage(
            parsedSlide,
            i,
            ownerEmail,
          );
          const html = convertToSlideHtml(parsedSlide, imageUrl, themeFont);
          return {
            slide: {
              id: `slide-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              content: html,
              layout: parsedSlide.layoutHint ?? "content",
              notes: parsedSlide.notes,
            },
            // Only the first image on a slide is ever uploaded, so every
            // other image on that slide is unconditionally dropped too —
            // not just the first one when it's unsupported.
            imageSkippedCount: Math.max(
              0,
              parsedSlide.images.length - (imageUrl ? 1 : 0),
            ),
          };
        }),
      ),
    );
    const slides = results.map((r) => r.slide);
    const imagesSkipped = results.reduce(
      (total, r) => total + r.imageSkippedCount,
      0,
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

      const data = { title: deckTitle, slides, updatedAt: now };
      await db
        .update(schema.decks)
        .set({ title: deckTitle, data: JSON.stringify(data), updatedAt: now })
        .where(eq(schema.decks.id, deckId));

      notifyClients(deckId);
      await writeAppState("refresh-signal", {
        ts: now,
        source: "import-pptx",
      });

      return {
        id: deckId,
        title: deckTitle,
        slideCount: slides.length,
        theme: presentation.theme,
        imported: true,
        url: getDeckUrl(deckId),
        ...(imagesSkipped > 0 ? { imagesSkipped } : {}),
      };
    }

    // Create new deck
    const id = `deck-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const data = { title: deckTitle, slides, createdAt: now, updatedAt: now };
    await db.insert(schema.decks).values({
      id,
      title: deckTitle,
      data: JSON.stringify(data),
      ownerEmail,
      orgId: getRequestOrgId(),
      createdAt: now,
      updatedAt: now,
    });

    notifyClients(id);
    await writeAppState("refresh-signal", { ts: now, source: "import-pptx" });

    return {
      id,
      title: deckTitle,
      slideCount: slides.length,
      theme: presentation.theme,
      imported: true,
      url: getDeckUrl(id),
      ...(imagesSkipped > 0 ? { imagesSkipped } : {}),
    };
  },
});
