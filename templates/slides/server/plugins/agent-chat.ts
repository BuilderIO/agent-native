import {
  createAgentChatPlugin,
  autoDiscoverActions,
} from "@agent-native/core/server";
import { getOrgContext } from "@agent-native/core/org";

export default createAgentChatPlugin({
  appId: "slides",
  actions: () => autoDiscoverActions(import.meta.url),
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  mentionProviders: async () => {
    const { getDb } = await import("../db/index.js");
    const { decks } = await import("../db/schema.js");
    const { like, desc } = await import("drizzle-orm");
    return {
      decks: {
        label: "Decks",
        icon: "deck",
        search: async (query: string) => {
          const db = getDb();
          const rows = query
            ? await db
                .select()
                .from(decks)
                .where(like(decks.title, `%${query}%`))
                .limit(15)
            : await db
                .select()
                .from(decks)
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
