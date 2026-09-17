import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { notifyClients } from "../server/handlers/decks.js";
import { parseDesignSystemIndexingStatus } from "../shared/design-system-validation.js";

export default defineAction({
  description:
    "Link a design system to a deck. The deck will use this design system's " +
    "colors, typography, and styling. Requires editor access on the deck. " +
    "The design system must have finished Builder indexing (list-design-systems " +
    "reports indexingStatus 'ready'); a still-indexing or unavailable system is rejected.",
  schema: z.object({
    deckId: z.string().describe("Deck ID to apply the design system to"),
    designSystemId: z.string().describe("Design system ID to link to the deck"),
  }),
  run: async ({ deckId, designSystemId }) => {
    // Verify access to both the deck and the design system
    await assertAccess("deck", deckId, "editor");
    const designSystemAccess = await assertAccess(
      "design-system",
      designSystemId,
      "viewer",
    );
    const indexingStatus = parseDesignSystemIndexingStatus(
      designSystemAccess.resource.data,
    );
    if (indexingStatus !== "ready") {
      throw Object.assign(
        new Error(
          indexingStatus === "indexing"
            ? `Design system ${designSystemId} is still indexing and has no usable tokens/components yet. Wait for indexing to finish, or use a different design system.`
            : `Design system ${designSystemId} is unavailable (indexing failed or its data could not be read). Choose a different design system.`,
        ),
        { statusCode: 409 },
      );
    }

    const db = getDb();
    const now = new Date().toISOString();

    await db
      .update(schema.decks)
      .set({ designSystemId, updatedAt: now })
      .where(eq(schema.decks.id, deckId));

    await notifyClients(deckId);

    return { deckId, designSystemId, applied: true };
  },
});
