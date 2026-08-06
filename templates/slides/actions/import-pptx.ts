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
import { parsePptx } from "../server/handlers/import/pptx-parser.js";
import { getDeckUrl } from "./_app-url.js";
import { readUserUploadedFile } from "./_uploaded-files.js";

export async function importPptxBufferToDeck(args: {
  fileBuffer: Buffer;
  title?: string;
  deckId?: string;
  source?: string;
}): Promise<{
  id: string;
  title: string;
  slideCount: number;
  theme: Awaited<ReturnType<typeof parsePptx>>["theme"];
  imported: true;
  url: string;
  imagesSkipped?: number;
}> {
  const { fileBuffer, title, deckId, source = "import-pptx" } = args;
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
        return {
          slide: {
            id: `slide-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            content: html,
            layout: parsedSlide.layoutHint ?? "content",
            notes: parsedSlide.notes,
            ...(parsedSlide.transition
              ? { transition: parsedSlide.transition }
              : {}),
            ...(parsedSlide.splitByParagraph ? { splitByParagraph: true } : {}),
          },
          imageSkippedCount: uploadedImages.imageSkippedCount,
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
  await writeAppState("refresh-signal", { ts: now, source });

  return {
    id,
    title: deckTitle,
    slideCount: slides.length,
    theme: presentation.theme,
    imported: true,
    url: getDeckUrl(id),
    ...(imagesSkipped > 0 ? { imagesSkipped } : {}),
  };
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
    return importPptxBufferToDeck({ fileBuffer, deckId, title });
  },
});
