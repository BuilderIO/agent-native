import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { resolveAccess } from "@agent-native/core/sharing";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import { nanoid } from "nanoid";

export default defineAction({
  description:
    "Duplicate an existing deck, creating a new copy with a new ID. " +
    "Generates new IDs for all slides in the copy. Returns the new deck's ID, title, and slide count.",
  schema: z.object({
    deckId: z.string().describe("Source deck ID to duplicate"),
    title: z
      .string()
      .optional()
      .describe("Title for the copy (defaults to 'Copy of ...')"),
  }),
  run: async ({ deckId, title }) => {
    const access = await resolveAccess("deck", deckId);
    if (!access) throw new Error(`Deck not found: ${deckId}`);

    const source = access.resource;
    const db = getDb();
    const newId = `deck-${nanoid()}`;
    const now = new Date().toISOString();
    const deckData = JSON.parse(source.data);

    // Generate new IDs for all slides so edits to the copy don't collide
    for (const slide of deckData.slides || []) {
      slide.id = `slide-${nanoid(8)}`;
    }

    const newTitle = title || `Copy of ${source.title}`;
    deckData.title = newTitle;
    deckData.createdAt = now;
    deckData.updatedAt = now;

    await db.insert(schema.decks).values({
      id: newId,
      title: newTitle,
      data: JSON.stringify(deckData),
      designSystemId: source.designSystemId ?? null,
      createdAt: now,
      updatedAt: now,
      ownerEmail: getRequestUserEmail() || "local@localhost",
      orgId: getRequestOrgId() || null,
    });

    return {
      id: newId,
      title: newTitle,
      slideCount: (deckData.slides || []).length,
    };
  },
});
