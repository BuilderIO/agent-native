import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { deckHttpError } from "./_deck-write.js";

export default defineAction({
  description: "Revoke one snapshot share link for a deck so it stops working.",
  schema: z.object({
    deckId: z.string().min(1).describe("Deck ID"),
    token: z.string().min(1).describe("Share link token to revoke"),
  }),
  http: { method: "DELETE" },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async ({ deckId, token }) => {
    await assertAccess("deck", deckId, "admin");
    const revoked = await getDb()
      .delete(schema.deckShareLinks)
      .where(
        and(
          eq(schema.deckShareLinks.token, token),
          eq(schema.deckShareLinks.deckId, deckId),
        ),
      )
      .returning({ token: schema.deckShareLinks.token });
    if (revoked.length === 0) {
      throw deckHttpError(404, "Share link not found");
    }
    return { success: true };
  },
});
