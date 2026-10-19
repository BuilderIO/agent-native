import { defineAction, fail } from "@agent-native/core/action";
import { verifyScopedAgentAccessToken } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { toSharedDeck } from "../server/lib/shared-deck.js";
import { DECK_AGENT_RESOURCE_KIND } from "../shared/agent-readable.js";
import { isSlides2DeckData } from "../shared/deck-app-scope.js";

export default defineAction({
  title: "Read Slides deck through agent access",
  description:
    "Read a Slides deck from a short-lived deck-scoped agent access token, returning a presentation-safe snapshot without speaker notes.",
  schema: z.object({
    id: z.string().min(1).describe("Slides deck ID"),
    token: z.string().min(1).describe("Short-lived deck-scoped access token"),
  }),
  http: { method: "POST" },
  readOnly: true,
  requiresAuth: false,
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  run: async ({ id, token }) => {
    const access = verifyScopedAgentAccessToken(token, {
      resourceKind: DECK_AGENT_RESOURCE_KIND,
      resourceId: id,
    });
    if (!access.ok) {
      fail("Invalid or expired agent access token.", {
        errorCode: "agent_access_token_invalid",
        statusCode: 403,
      });
    }

    // guard:allow-unscoped -- A valid short-lived token is scoped to this deck ID.
    const [deck] = await getDb()
      .select({ title: schema.decks.title, data: schema.decks.data })
      .from(schema.decks)
      .where(eq(schema.decks.id, id))
      .limit(1);

    if (!deck || !isSlides2DeckData(deck.data)) {
      fail("Slides deck not found.", {
        errorCode: "deck_not_found",
        statusCode: 404,
      });
    }
    return toSharedDeck(deck);
  },
});
