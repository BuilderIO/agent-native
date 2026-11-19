import { defineAction } from "@agent-native/core/action";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import { z } from "zod";

import {
  hideDashboard,
  requireDashboardAccess,
  unhideDashboard,
} from "../server/lib/dashboards-store";
import {
  expectedUpdatedAtArg,
  guardWrite,
  idempotencyKeyArg,
} from "../server/lib/guarded-writes";
import { cliBoolean } from "./schema-helpers";

function resolveScope() {
  const orgId = getRequestOrgId() || null;
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");
  return { orgId, email };
}

export default defineAction({
  description:
    "Hide or unhide a saved analytics dashboard by ID. Hidden dashboards stay " +
    "openable by direct link and searchable, but they are omitted from regular " +
    "dashboard lists. When an unowned cleanup dashboard is unhidden, the current " +
    "user becomes its owner.",
  schema: z.object({
    id: z.string().describe("The dashboard ID"),
    hidden: cliBoolean
      .optional()
      .default(true)
      .describe("true = hide (default), false = unhide"),
    expectedUpdatedAt: expectedUpdatedAtArg("dashboard"),
    idempotencyKey: idempotencyKeyArg,
  }),
  mcpTool: true,
  run: async (args, actionContext) => {
    const ctx = resolveScope();
    const guard = guardWrite({
      action: "hide-dashboard",
      target: { kind: "dashboard", id: args.id },
      caller: actionContext?.caller,
      scope: ctx,
      idempotencyKey: args.idempotencyKey,
      expectedUpdatedAt: args.expectedUpdatedAt,
      request: { hidden: args.hidden },
    });
    guard.requireKey();
    guard.requireFence();
    const write = args.hidden ? hideDashboard : unhideDashboard;
    const outcome = await guard.run(
      () =>
        requireDashboardAccess(args.id, ctx, args.hidden ? "editor" : "viewer"),
      () =>
        guard.active ? write(args.id, ctx, guard.store) : write(args.id, ctx),
    );
    if ("replayed" in outcome) return { id: args.id, ...outcome.replayed };
    const dash = outcome.written;
    if (!dash) {
      throw new Error(
        `Dashboard "${args.id}" not found (or you don't have access).`,
      );
    }
    return {
      id: dash.id,
      name: dash.title,
      hiddenAt: dash.hiddenAt,
      hiddenBy: dash.hiddenBy,
      ownerEmail: dash.ownerEmail,
      ...guard.resultFields(dash),
      message: args.hidden
        ? `Dashboard "${dash.title}" hidden from regular lists.`
        : `Dashboard "${dash.title}" is visible in regular lists.`,
    };
  },
});
