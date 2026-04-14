import { defineAction } from "@agent-native/core";
import { getAllSettings, listOrgSettings } from "@agent-native/core/settings";

const KEY_PREFIX = "adhoc-analysis-";

export default defineAction({
  description:
    "List all saved ad-hoc analyses. Returns their IDs, names, descriptions, and last updated timestamps.",
  parameters: {},
  http: { method: "GET" },
  run: async () => {
    const orgId = process.env.AGENT_ORG_ID || null;
    const email = process.env.AGENT_USER_EMAIL || "local@localhost";

    const analyses: Record<string, unknown>[] = [];
    const seen = new Set<string>();

    const collect = (raw: unknown) => {
      const a = raw as Record<string, unknown> | null;
      if (!a || typeof a !== "object") return;
      const id = a.id as string | undefined;
      if (!id || seen.has(id)) return;
      seen.add(id);
      analyses.push({
        id,
        name: a.name,
        description: a.description,
        dataSources: a.dataSources,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
        author: a.author,
      });
    };

    // Org-scoped first (wins on id conflicts since it's collected first).
    if (orgId) {
      const orgAnalyses = await listOrgSettings(orgId, KEY_PREFIX);
      for (const value of Object.values(orgAnalyses)) collect(value);
    }

    // User-scoped (namespaced by `u:<email>:` prefix). No public
    // `listUserSettings` helper exists, so iterate the table once and
    // filter by the exact user prefix — NOT a substring match (that was
    // the vulnerability: it leaked every user's analyses to everyone).
    const userPrefix = `u:${email}:${KEY_PREFIX}`;
    const all = await getAllSettings();
    for (const [fullKey, value] of Object.entries(all)) {
      if (!fullKey.startsWith(userPrefix)) continue;
      collect(value);
    }

    analyses.sort(
      (a: any, b: any) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

    return analyses;
  },
});
