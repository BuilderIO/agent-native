import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";
import actionsRegistry from "../../.generated/actions-registry.js";
import { getOrgContext } from "@agent-native/core/org";

export default createAgentChatPlugin({
  appId: "forms",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  mentionProviders: async () => {
    const { getDb } = await import("../db/index.js");
    const { forms, formShares } = await import("../db/schema.js");
    const { like, desc, and } = await import("drizzle-orm");
    const { accessFilter } = await import("@agent-native/core/sharing");
    return {
      forms: {
        label: "Forms",
        icon: "form",
        search: async (query: string) => {
          const db = getDb();
          const access = accessFilter(forms, formShares);
          const rows = query
            ? await db
                .select()
                .from(forms)
                .where(and(access, like(forms.title, `%${query}%`)))
                .limit(15)
            : await db
                .select()
                .from(forms)
                .where(access)
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
