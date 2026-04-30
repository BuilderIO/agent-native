import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import { listAnalyses } from "../server/lib/dashboards-store";

export default defineAction({
  description:
    "List all saved ad-hoc analyses. Returns their IDs, names, descriptions, and last updated timestamps.",
  parameters: {},
  http: { method: "GET" },
  run: async () => {
    const orgId = getRequestOrgId() || null;
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const rows = await listAnalyses({ email, orgId });
    return rows
      .map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        dataSources: a.dataSources,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
        author: a.author,
        ownerEmail: a.ownerEmail,
        visibility: a.visibility,
      }))
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  },
});
