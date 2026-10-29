import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, desc, eq, gte } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { SHARE_LINK_TTL_MS } from "../server/lib/deck-share-links.js";

export default defineAction({
  description:
    "List the live snapshot share links for a deck (newest first). Expired links are omitted.",
  schema: z.object({ deckId: z.string().min(1).describe("Deck ID") }),
  http: { method: "GET" },
  mcpAnnotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async ({ deckId }) => {
    await assertAccess("deck", deckId, "admin");
    const links = await getDb()
      .select({
        token: schema.deckShareLinks.token,
        createdAt: schema.deckShareLinks.createdAt,
      })
      .from(schema.deckShareLinks)
      .where(
        and(
          eq(schema.deckShareLinks.deckId, deckId),
          gte(
            schema.deckShareLinks.createdAt,
            new Date(Date.now() - SHARE_LINK_TTL_MS).toISOString(),
          ),
        ),
      )
      .orderBy(desc(schema.deckShareLinks.createdAt));
    return { links };
  },
});
