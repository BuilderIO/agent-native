import { defineAction } from "@agent-native/core";
import {
  hasCollabState,
  applyText,
  seedFromText,
} from "@agent-native/core/collab";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import { z } from "zod";

import { upsertDashboardWithRetry } from "../server/lib/dashboards-store";

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
    // Recomputed on every retry attempt from the freshest dashboard config, so
    // a concurrent panel edit (mutate-dashboard/update-dashboard) racing this
    // rename is never silently overwritten by a stale config snapshot.
    const updated = await upsertDashboardWithRetry(args.id, ctx, (existing) => {
      return { kind: existing.kind, body: { ...existing.config, name } };
    });
    await syncToCollab(args.id, updated.config);
    return { id: updated.id, name: updated.title };
  },
});
