import {
  createAgentChatPlugin,
  autoDiscoverActions,
} from "@agent-native/core/server";

export default createAgentChatPlugin({
  appId: "forms",
  actions: () => autoDiscoverActions(import.meta.url),
  mentionProviders: async () => {
    const { getDb } = await import("../db/index.js");
    const { forms } = await import("../db/schema.js");
    const { like, desc } = await import("drizzle-orm");
    return {
      forms: {
        label: "Forms",
        icon: "form",
        search: async (query: string) => {
          const db = getDb();
          const rows = query
            ? await db
                .select()
                .from(forms)
                .where(like(forms.title, `%${query}%`))
                .limit(15)
            : await db
                .select()
                .from(forms)
                .orderBy(desc(forms.updatedAt))
                .limit(15);
          return rows.map((form) => ({
            id: form.id,
            label: form.title,
            description:
              form.status === "published"
                ? "Published"
                : form.status === "closed"
                  ? "Closed"
                  : "Draft",
            icon: "form" as const,
            refType: "form",
            refId: form.id,
          }));
        },
      },
    };
  },
});
