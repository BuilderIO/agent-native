import { defineAction } from "@agent-native/core";
import {
  getAllSettings,
  getOrgSetting,
  getUserSetting,
  listOrgSettings,
} from "@agent-native/core/settings";

const KEY_PREFIX = "adhoc-analysis-";

export default defineAction({
  description:
    "List all saved ad-hoc analyses. Returns their IDs, names, descriptions, and last updated timestamps.",
  parameters: {},
  http: { method: "GET" },
  run: async () => {
    const orgId = process.env.AGENT_ORG_ID || null;
    const email = process.env.AGENT_USER_EMAIL || "local@localhost";

    const all = await getAllSettings();
    const analyses: Record<string, unknown>[] = [];

    // Collect from all scopes (org > user > global)
    for (const [key, value] of Object.entries(all)) {
      if (!key.includes(KEY_PREFIX)) continue;
      const raw = value as any;
      analyses.push({
        id: raw.id,
        name: raw.name,
        description: raw.description,
        dataSources: raw.dataSources,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
        author: raw.author,
      });
    }

    // Dedupe by id (org-scoped wins)
    const seen = new Set<string>();
    const deduped = analyses.filter((a: any) => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });

    // Sort by updatedAt desc
    deduped.sort(
      (a: any, b: any) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

    return deduped;
  },
});
