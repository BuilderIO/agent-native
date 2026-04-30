import { defineAction } from "@agent-native/core";
import { getDbExec } from "@agent-native/core/db";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";
import "../server/db/index.js"; // ensure registerShareableResource runs

export default defineAction({
  description: "List all comments on a slide, ordered by creation time.",
  schema: z.object({
    deckId: z.string().describe("Deck ID"),
    slideId: z.string().describe("Slide ID"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const { deckId, slideId } = args;
    await assertAccess("deck", deckId, "viewer");

    const client = getDbExec();
    const { rows } = await client.execute({
      sql: `SELECT * FROM slide_comments WHERE deck_id = ? AND slide_id = ? ORDER BY created_at ASC`,
      args: [deckId, slideId],
    });
    return { comments: rows };
  },
});
