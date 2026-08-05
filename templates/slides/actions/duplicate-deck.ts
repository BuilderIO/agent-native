import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { getDeckUrl } from "./_app-url.js";

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
    newId: z
      .string()
      .optional()
      .describe(
        "Optional client-supplied id for the new deck. Lets the UI pick the id ahead of time so it can navigate optimistically before the server responds.",
      ),
    slideIds: z
      .array(z.string().min(1).max(64))
      .max(1000)
      .optional()
      .describe(
        "Optional client-supplied ids for the copied slides, in slide order. Same purpose as `newId`: when the UI opens an optimistic copy the user can edit immediately, its slide ids must match the persisted copy or those edits address slides the server never had.",
      ),
  }),
  run: async ({ deckId, title, newId: clientNewId, slideIds }) => {
    const access = await resolveAccess("deck", deckId);
    if (!access) throw new Error(`Deck not found: ${deckId}`);

    const source = access.resource;
    const db = getDb();
    const newId = clientNewId || `deck-${nanoid()}`;
    const now = new Date().toISOString();
    const deckData = JSON.parse(source.data);

    // New IDs for all slides so edits to the copy don't collide with the
    // original. A caller that already rendered an optimistic copy supplies the
    // ids it used; anything it did not cover still gets a fresh one.
    const slides = deckData.slides || [];
    for (const [index, slide] of slides.entries()) {
      slide.id = slideIds?.[index] ?? `slide-${nanoid(8)}`;
    }
    if (
      new Set(slides.map((s: { id: string }) => s.id)).size !== slides.length
    ) {
      throw new Error("slideIds must be unique");
    }

    const newTitle = title || `Copy of ${source.title}`;
    deckData.title = newTitle;
    deckData.createdAt = now;
    deckData.updatedAt = now;
    deckData.designSystemId = source.designSystemId ?? deckData.designSystemId;

    await db.insert(schema.decks).values({
      id: newId,
      title: newTitle,
      data: JSON.stringify(deckData),
      designSystemId: source.designSystemId ?? null,
      createdAt: now,
      updatedAt: now,
      ownerEmail: (() => {
        const e = getRequestUserEmail();
        if (!e) throw new Error("no authenticated user");
        return e;
      })(),
      orgId: getRequestOrgId() || null,
    });

    return {
      id: newId,
      title: newTitle,
      slideCount: (deckData.slides || []).length,
      url: getDeckUrl(newId),
    };
  },
});
