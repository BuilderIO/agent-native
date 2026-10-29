import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { repairDeckSlideReferences } from "../shared/slide-ids.js";
import { getDeckUrl } from "./_app-url.js";
import { trackDeckCreated } from "./_deck-tracking.js";

// The 23505 code sits on the driver error that Drizzle wraps, not on the top-level error.
function isUniqueViolation(error: unknown): boolean {
  let current = error;
  for (
    let depth = 0;
    depth < 4 && current && typeof current === "object";
    depth++
  ) {
    if ("code" in current && current.code === "23505") return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

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
  http: { method: "POST" },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async ({ deckId, title, newId: clientNewId, slideIds }, ctx) => {
    const access = await resolveAccess("deck", deckId);
    if (!access)
      fail(`Deck not found: ${deckId}`, {
        errorCode: "deck_not_found",
        statusCode: 404,
      });

    const source = access.resource;
    const db = getDb();
    const newId = clientNewId || `deck-${nanoid()}`;
    const now = new Date().toISOString();
    const deckData = JSON.parse(source.data);

    const slides = deckData.slides || [];
    const originalSlideIds = slides.map((slide: { id?: unknown }) =>
      typeof slide.id === "string" ? slide.id : null,
    );
    for (const [index, slide] of slides.entries()) {
      slide.id = slideIds?.[index] ?? `slide-${nanoid(8)}`;
    }
    if (
      new Set(slides.map((s: { id: string }) => s.id)).size !== slides.length
    ) {
      fail("slideIds must be unique", {
        errorCode: "invalid_slide_ids",
        statusCode: 400,
      });
    }

    const newTitle = title || `Copy of ${source.title}`;
    Object.assign(
      deckData,
      repairDeckSlideReferences(deckData, slides, originalSlideIds),
    );
    deckData.title = newTitle;
    deckData.createdAt = now;
    deckData.updatedAt = now;
    deckData.designSystemId = source.designSystemId ?? deckData.designSystemId;

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail)
      fail("no authenticated user", {
        errorCode: "not_authenticated",
        statusCode: 401,
      });

    try {
      await db.insert(schema.decks).values({
        id: newId,
        title: newTitle,
        data: JSON.stringify(deckData),
        designSystemId: source.designSystemId ?? null,
        createdAt: now,
        updatedAt: now,
        ownerEmail,
        orgId: getRequestOrgId() || null,
      });
    } catch (error) {
      // The raw driver error names the SQL and its parameters, which must not reach callers.
      if (isUniqueViolation(error))
        fail(`A deck with id ${newId} already exists.`, {
          errorCode: "deck_id_conflict",
          statusCode: 409,
        });
      console.error("[duplicate-deck] insert failed", error);
      fail("Could not duplicate the deck.", {
        errorCode: "deck_duplicate_failed",
        statusCode: 500,
      });
    }

    await trackDeckCreated(
      newId,
      {
        creationMethod: "duplicate",
        purpose: "direct",
        slideCount: (deckData.slides || []).length,
      },
      ctx,
    );

    return {
      id: newId,
      title: newTitle,
      slideCount: (deckData.slides || []).length,
      url: getDeckUrl(newId),
      appUrl: getDeckUrl(newId),
    };
  },
});
