import { defineAction } from "@agent-native/core/action";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import { z } from "zod";

import {
  hideAnalysis,
  requireAnalysisAccess,
  unhideAnalysis,
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
    "Hide or unhide a saved ad-hoc analysis by ID. Hidden analyses stay " +
    "openable by direct link and searchable, but they are omitted from regular " +
    "analysis lists. When an unowned cleanup analysis is unhidden, the current " +
    "user becomes its owner. External MCP clients have no hard delete; this is " +
    "how they delete an analysis.",
  schema: z.object({
    id: z.string().describe("The analysis ID"),
    hidden: cliBoolean
      .optional()
      .default(true)
      .describe("true = hide (default), false = unhide"),
    expectedUpdatedAt: expectedUpdatedAtArg("analysis"),
    idempotencyKey: idempotencyKeyArg,
  }),
  mcpTool: true,
  run: async (args, actionContext) => {
    const ctx = resolveScope();
    const guard = guardWrite({
      action: "hide-analysis",
      target: { kind: "analysis", id: args.id },
      caller: actionContext?.caller,
      scope: ctx,
      idempotencyKey: args.idempotencyKey,
      expectedUpdatedAt: args.expectedUpdatedAt,
      request: { hidden: args.hidden },
    });
    guard.requireKey();
    guard.requireFence();
    const write = args.hidden ? hideAnalysis : unhideAnalysis;
    const outcome = await guard.run(
      () =>
        requireAnalysisAccess(args.id, ctx, args.hidden ? "editor" : "viewer"),
      () =>
        guard.active ? write(args.id, ctx, guard.store) : write(args.id, ctx),
    );
    if ("replayed" in outcome) return { id: args.id, ...outcome.replayed };
    const analysis = outcome.written;
    if (!analysis) {
      throw new Error(
        `Analysis "${args.id}" not found (or you don't have access).`,
      );
    }
    return {
      id: analysis.id,
      name: analysis.name,
      hiddenAt: analysis.hiddenAt,
      hiddenBy: analysis.hiddenBy,
      ownerEmail: analysis.ownerEmail,
      ...guard.resultFields(analysis),
      message: args.hidden
        ? `Analysis "${analysis.name}" hidden from regular lists.`
        : `Analysis "${analysis.name}" is visible in regular lists.`,
    };
  },
});
