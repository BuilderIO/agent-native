import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import { z } from "zod";
import { keepDashboard, keepAnalysis } from "../server/lib/dashboards-store";

function resolveScope() {
  const orgId = getRequestOrgId() || null;
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");
  return { orgId, email };
}

export default defineAction({
  description:
    "Mark a dashboard or analysis as 'kept' during the one-time cleanup pass. " +
    "All existing resources were made org-visible so teammates can review them. " +
    "Resources without a keep mark will be deleted after the pass is complete. " +
    "Any org member with read access can keep a resource.",
  schema: z.object({
    resourceType: z
      .enum(["dashboard", "analysis"])
      .describe("Whether to keep a dashboard or an analysis"),
    resourceId: z.string().describe("The ID of the resource to keep"),
  }),
  run: async (args) => {
    const ctx = resolveScope();
    if (args.resourceType === "dashboard") {
      const dash = await keepDashboard(args.resourceId, ctx);
      if (!dash) {
        throw new Error(
          `Dashboard "${args.resourceId}" not found (or you don't have access).`,
        );
      }
      return {
        id: dash.id,
        name: dash.title,
        keptAt: dash.keptAt,
        message: `Dashboard "${dash.title}" marked as kept — it will survive the cleanup pass.`,
      };
    } else {
      const analysis = await keepAnalysis(args.resourceId, ctx);
      if (!analysis) {
        throw new Error(
          `Analysis "${args.resourceId}" not found (or you don't have access).`,
        );
      }
      return {
        id: analysis.id,
        name: analysis.name,
        keptAt: analysis.keptAt,
        message: `Analysis "${analysis.name}" marked as kept — it will survive the cleanup pass.`,
      };
    }
  },
});
