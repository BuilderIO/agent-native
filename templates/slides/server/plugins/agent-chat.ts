import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";
import actionsRegistry from "../../.generated/actions-registry.js";
import { getOrgContext } from "@agent-native/core/org";
import "../register-secrets.js";

export default createAgentChatPlugin({
  appId: "slides",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  runSoftTimeoutMs: 240_000,
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  mentionProviders: async () => {
    const { getDb } = await import("../db/index.js");
    const { decks, deckShares } = await import("../db/schema.js");
    const { like, desc, and } = await import("drizzle-orm");
    const { accessFilter } = await import("@agent-native/core/sharing");
    return {
      decks: {
        label: "Decks",
        icon: "deck",
        search: async (query: string) => {
          const db = getDb();
          const access = accessFilter(decks, deckShares);
          const rows = query
            ? await db
                .select()
                .from(decks)
                .where(and(access, like(decks.title, `%${query}%`)))
                .limit(15)
            : await db
                .select()
                .from(decks)
                .where(access)
                .orderBy(desc(decks.updatedAt))
                .limit(15);
          return rows.map((deck) => ({
            id: deck.id,
            label: deck.title,
            icon: "deck" as const,
            refType: "deck",
            refId: deck.id,
          }));
        },
      },
    };
  },
});
