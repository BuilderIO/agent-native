import {
  createAgentChatPlugin,
  autoDiscoverActions,
} from "@agent-native/core/server";

export default createAgentChatPlugin({
  appId: "content",
  actions: () => autoDiscoverActions(import.meta.url),
  mentionProviders: async () => {
    const { getDb } = await import("../db/index.js");
    const { documents } = await import("../db/schema.js");
    const { like, desc } = await import("drizzle-orm");
    return {
      documents: {
        label: "Documents",
        icon: "document",
        search: async (query: string) => {
          const db = getDb();
          const rows = query
            ? await db
                .select()
                .from(documents)
                .where(like(documents.title, `%${query}%`))
                .limit(15)
            : await db
                .select()
                .from(documents)
                .orderBy(desc(documents.updatedAt))
                .limit(15);
          return rows.map((doc) => ({
            id: doc.id,
            label: doc.title,
            description: doc.parentId ? "Sub-page" : undefined,
            icon: "document" as const,
            refType: "document",
            refId: doc.id,
          }));
        },
      },
    };
  },
});
