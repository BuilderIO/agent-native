import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess } from "@agent-native/core/sharing";
import { writeAppState } from "@agent-native/core/application-state";
import { ASPECT_RATIO_VALUES } from "../shared/aspect-ratios.js";
import { notifyClients } from "../server/handlers/decks.js";

export default defineAction({
  description:
    "Set the aspect ratio of a deck. Affects editor canvas, presentation, " +
    "thumbnails, PDF, and PPTX export. Choices: 16:9, 1:1, 9:16, 4:5.",
  schema: z.object({
    deckId: z.string().describe("Deck ID"),
    aspectRatio: z.enum(ASPECT_RATIO_VALUES).describe("Target aspect ratio"),
  }),
  run: async ({ deckId, aspectRatio }) => {
    await assertAccess("deck", deckId, "editor");
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.decks)
      .where(eq(schema.decks.id, deckId))
      .limit(1);
    if (!rows.length) throw new Error(`Deck not found: ${deckId}`);
    const data = JSON.parse(rows[0].data);
    data.aspectRatio = aspectRatio;
    const now = new Date().toISOString();
    data.updatedAt = now;
    await db
      .update(schema.decks)
      .set({ data: JSON.stringify(data), updatedAt: now })
      .where(eq(schema.decks.id, deckId));
    notifyClients(deckId);
    await writeAppState("refresh-signal", {
      ts: now,
      source: "update-deck-aspect-ratio",
    });
    return { id: deckId, aspectRatio };
  },
});
