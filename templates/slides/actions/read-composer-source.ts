import { defineAction, fail } from "@agent-native/core/action";
import {
  composerSourceRequestSchema,
  composerSourceResultSchema,
} from "@agent-native/core/shared";

import getDeckReferenceContext from "./get-deck-reference-context.js";
import listDecks from "./list-decks.js";

export default defineAction({
  description:
    "Browse or read a local deck reference for a prompt. Returns bounded visual/layout context without importing or replacing slides.",
  schema: composerSourceRequestSchema,
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: false, readOnly: true },
  run: async (args, ctx) => {
    if (args.source !== "slides")
      fail("Cross-app reference sharing is not enabled.", {
        statusCode: 409,
        errorCode: "composer_peer_not_connected",
      });
    if (args.operation === "list") {
      const result = await listDecks.run(
        { limit: 30, cursor: args.cursor, search: args.search },
        ctx,
      );
      const nextCursor = "nextCursor" in result ? result.nextCursor : undefined;
      return composerSourceResultSchema.parse({
        items: result.decks.map((item) => ({ id: item.id, title: item.title })),
        hasMore: Boolean(nextCursor),
        ...(nextCursor ? { nextCursor } : {}),
      });
    }
    if (!args.id)
      fail("Choose a deck to attach.", {
        errorCode: "composer_reference_required",
      });
    const result = await getDeckReferenceContext.run({ id: args.id }, ctx);
    return composerSourceResultSchema.parse({
      id: result.id,
      title: result.title,
      context: result.agentContext,
    });
  },
});
