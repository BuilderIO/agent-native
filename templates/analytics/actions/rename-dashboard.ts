import { defineAction } from "@agent-native/core/action";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import { z } from "zod";

import { queueDashboardCollabSync } from "../server/lib/dashboard-collab-sync";
import {
  getDashboard,
  requireDashboardAccess,
  upsertDashboardWithRetry,
  type DashboardRecord,
} from "../server/lib/dashboards-store";
import {
  expectedUpdatedAtArg,
  guardWrite,
  idempotencyKeyArg,
} from "../server/lib/guarded-writes";

function resolveScope() {
  const orgId = getRequestOrgId() || null;
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");
  return { orgId, email };
}

export default defineAction({
  description:
    "Rename a saved analytics dashboard by ID. To change panels or other dashboard fields in the same save, use mutate-dashboard instead.",
  schema: z.object({
    id: z.string().describe("The dashboard ID to rename"),
    name: z.string().describe("The new dashboard name"),
    expectedUpdatedAt: expectedUpdatedAtArg("dashboard"),
    idempotencyKey: idempotencyKeyArg,
  }),
  mcpTool: true,
  run: async (args, actionContext) => {
    const name = args.name.trim();
    if (!name) throw new Error("name is required");

    const ctx = resolveScope();
    const guard = guardWrite({
      action: "rename-dashboard",
      target: { kind: "dashboard", id: args.id },
      caller: actionContext?.caller,
      scope: ctx,
      idempotencyKey: args.idempotencyKey,
      expectedUpdatedAt: args.expectedUpdatedAt,
      request: { name },
    });
    guard.requireKey();
    guard.requireFence();
    const rename = (existing: DashboardRecord) => ({
      kind: existing.kind,
      body: { ...existing.config, name },
    });
    const outcome = await guard.run(
      () => requireDashboardAccess(args.id, ctx, "editor"),
      () =>
        guard.active
          ? upsertDashboardWithRetry(
              args.id,
              ctx,
              rename,
              undefined,
              guard.store,
            )
          : upsertDashboardWithRetry(args.id, ctx, rename),
    );
    if ("replayed" in outcome) return { id: args.id, ...outcome.replayed };
    const updated = outcome.written;
    void queueDashboardCollabSync(
      args.id,
      updated.updatedAt,
      () => getDashboard(args.id, ctx),
      actionContext?.caller === "frontend" ? undefined : "agent",
    );
    return {
      id: updated.id,
      name: updated.title,
      ...guard.resultFields(updated),
    };
  },
});
