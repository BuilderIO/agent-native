import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import { z } from "zod";
import {
  getDashboard,
  upsertDashboard,
} from "../server/lib/dashboards-store";
import {
  hasCollabState,
  applyText,
  seedFromText,
} from "@agent-native/core/collab";

function resolveScope() {
  const orgId = getRequestOrgId() || null;
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");
  return { orgId, email };
}

async function syncToCollab(
  dashboardId: string,
  config: Record<string, unknown>,
): Promise<void> {
  const docId = `dash-${dashboardId}`;
  const configStr = JSON.stringify(config);
  try {
    if (await hasCollabState(docId)) {
      await applyText(docId, configStr, "content", "agent");
    } else {
      await seedFromText(docId, configStr);
    }
  } catch {
    // Best-effort: SQL remains the source of truth.
  }
}

export default defineAction({
  description: "Rename a saved analytics dashboard by ID.",
  schema: z.object({
    id: z.string().describe("The dashboard ID to rename"),
    name: z.string().describe("The new dashboard name"),
  }),
  run: async (args) => {
    const name = args.name.trim();
    if (!name) throw new Error("name is required");

    const ctx = resolveScope();
    const dashboard = await getDashboard(args.id, ctx);
    if (!dashboard) throw new Error("Dashboard not found");

    const config = { ...dashboard.config, name };
    const updated = await upsertDashboard(args.id, dashboard.kind, config, ctx);
    await syncToCollab(args.id, config);
    return { id: updated.id, name: updated.title };
  },
});
