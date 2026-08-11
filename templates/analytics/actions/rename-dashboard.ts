import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import { z } from "zod";

import { queueDashboardCollabSync } from "../server/lib/dashboard-collab-sync";
import { upsertDashboardWithRetry } from "../server/lib/dashboards-store";

function resolveScope() {
  const orgId = getRequestOrgId() || null;
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");
  return { orgId, email };
}

export default defineAction({
  description: "Rename a saved analytics dashboard by ID.",
  schema: z.object({
    id: z.string().describe("The dashboard ID to rename"),
    name: z.string().describe("The new dashboard name"),
  }),
  run: async (args, actionContext) => {
    const name = args.name.trim();
    if (!name) throw new Error("name is required");

    const ctx = resolveScope();
    // Recomputed on every retry attempt from the freshest dashboard config, so
    // a concurrent panel edit (mutate-dashboard/update-dashboard) racing this
    // rename is never silently overwritten by a stale config snapshot.
    const updated = await upsertDashboardWithRetry(args.id, ctx, (existing) => {
      return { kind: existing.kind, body: { ...existing.config, name } };
    });
    queueDashboardCollabSync(
      args.id,
      updated.config,
      actionContext?.caller === "frontend" ? undefined : "agent",
    );
    return { id: updated.id, name: updated.title };
  },
});
