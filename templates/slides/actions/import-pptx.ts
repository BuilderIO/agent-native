import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { writeAppState } from "@agent-native/core/application-state";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { notifyClients } from "../server/handlers/decks.js";
import { parsePptx } from "../server/handlers/import/pptx-parser.js";
import { convertToSlideHtml } from "../server/handlers/import/html-converter.js";
import fs from "fs";
import { resolveUserUploadedFile } from "./_uploaded-files.js";

export default defineAction({
  description:
    "Import a PPTX file and create a slide deck from it. " +
    "Parses the PowerPoint file, extracts text and layout information, " +
    "converts each slide to the app's HTML format, and creates or updates a deck. " +
    "Returns the deck ID and slide count.",
  schema: z.object({
    filePath: z
      .string()
      .describe(
        "Server path to the uploaded PPTX file (e.g. data/uploads/presentation.pptx)",
      ),
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
    const absPath = resolveUserUploadedFile(filePath);

    const fileBuffer = await fs.promises.readFile(absPath);
    const presentation = await parsePptx(fileBuffer);

    const deckTitle = title || presentation.title || "Imported Presentation";

    // Convert each parsed slide to our HTML format
    const slides = presentation.slides.map((parsedSlide, i) => {
      const html = convertToSlideHtml(parsedSlide);
      return {
        id: `slide-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        content: html,
        layout: parsedSlide.layoutHint ?? "content",
        notes: parsedSlide.notes,
      };
    });

    const db = getDb();
    const now = new Date().toISOString();

    if (deckId) {
      await assertAccess("deck", deckId, "editor");

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
      };
    }

    // Create new deck
    const id = `deck-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const data = { title: deckTitle, slides, createdAt: now, updatedAt: now };
    await db.insert(schema.decks).values({
      id,
      title: deckTitle,
      data: JSON.stringify(data),
      ownerEmail: (() => {
        const e = getRequestUserEmail();
        if (!e) throw new Error("no authenticated user");
        return e;
      })(),
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
    };
  },
});
