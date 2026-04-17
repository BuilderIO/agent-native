import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";
import actionsRegistry from "../../.generated/actions-registry.js";
import { getOrgContext } from "@agent-native/core/org";

export default createAgentChatPlugin({
  appId: "content",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  mentionProviders: async () => {
    const { getDb } = await import("../db/index.js");
    const { documents } = await import("../db/schema.js");
    const { and, desc, eq, like } = await import("drizzle-orm");
    const { getCurrentOwnerEmail } = await import("../lib/documents.js");
    return {
      documents: {
        label: "Documents",
        icon: "document",
        search: async (query: string) => {
          const db = getDb();
          const ownerEmail = getCurrentOwnerEmail();
          const rows = query
            ? await db
                .select()
                .from(documents)
                .where(
                  and(
                    eq(documents.ownerEmail, ownerEmail),
                    like(documents.title, `%${query}%`),
                  ),
                )
                .limit(15)
            : await db
                .select()
                .from(documents)
                .where(eq(documents.ownerEmail, ownerEmail))
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
