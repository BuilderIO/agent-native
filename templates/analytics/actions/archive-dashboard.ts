import { defineAction } from "@agent-native/core/action";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import { z } from "zod";

import {
  archiveDashboard,
  requireDashboardAccess,
  unarchiveDashboard,
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
    "Archive (soft-delete) or restore a saved dashboard by ID. Archived dashboards " +
    "stay in the database but are hidden from dashboard lists. There is no explicit " +
    "restore UI; restore them by running this action with `archived: false`. Use " +
    "this instead of `delete-dashboard` when the user might want the dashboard back " +
    "later — only use a hard delete when the user explicitly asks to remove a " +
    "dashboard permanently. External MCP clients have no hard delete; this is " +
    "how they delete a dashboard.",
  schema: z.object({
    id: z.string().describe("The dashboard ID"),
    archived: cliBoolean
      .optional()
      .default(true)
      .describe(
        "true = archive (default), false = restore an archived dashboard",
      ),
    expectedUpdatedAt: expectedUpdatedAtArg("dashboard"),
    idempotencyKey: idempotencyKeyArg,
  }),
  http: { method: "POST" },
  mcpTool: true,
  run: async (args, actionContext) => {
    const ctx = resolveScope();
    const guard = guardWrite({
      action: "archive-dashboard",
      target: { kind: "dashboard", id: args.id },
      caller: actionContext?.caller,
      scope: ctx,
      idempotencyKey: args.idempotencyKey,
      expectedUpdatedAt: args.expectedUpdatedAt,
      request: { archived: args.archived },
    });
    guard.requireKey();
    guard.requireFence();
    const write = args.archived ? archiveDashboard : unarchiveDashboard;
    const outcome = await guard.run(
      () => requireDashboardAccess(args.id, ctx, "editor"),
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
      archivedAt: dash.archivedAt,
      ...guard.resultFields(dash),
      message: args.archived
        ? `Dashboard "${dash.title}" archived. Ask the agent in chat to restore it if needed.`
        : `Dashboard "${dash.title}" restored.`,
    };
  },
});
