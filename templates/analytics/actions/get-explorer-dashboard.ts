import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import { z } from "zod";
import { getDashboard } from "../server/lib/dashboards-store";

export default defineAction({
  description:
    "Get an explorer (BigQuery explorer) dashboard by ID, including its full chart config, visibility, and access metadata.",
  schema: z.object({
    id: z.string().describe("The explorer dashboard ID"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() || null;
    const ctx = { email, orgId };

    const dash = await getDashboard(args.id, ctx);
    if (!dash || dash.kind !== "explorer") {
      throw Object.assign(new Error("Dashboard not found"), {
        statusCode: 404,
      });
    }
    return {
      id: args.id,
      ...(dash.config as Record<string, unknown>),
      ownerEmail: dash.ownerEmail,
      orgId: dash.orgId,
      visibility: dash.visibility,
      role: dash.role,
      canEdit: dash.canEdit,
      canManage: dash.canManage,
      archivedAt: dash.archivedAt,
      hiddenAt: dash.hiddenAt,
      hiddenBy: dash.hiddenBy,
    };
  },
});
