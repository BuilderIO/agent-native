import { defineAction } from "@agent-native/core/action";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import { z } from "zod";

import {
  requireAnalysisAccess,
  upsertAnalysisWithRetry,
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
    "Rename a saved ad-hoc analysis by ID. To change its question, instructions, or results, use save-analysis instead.",
  schema: z.object({
    id: z.string().describe("The analysis ID to rename"),
    name: z.string().describe("The new analysis name"),
    expectedUpdatedAt: expectedUpdatedAtArg("analysis"),
    idempotencyKey: idempotencyKeyArg,
  }),
  mcpTool: true,
  run: async (args, actionContext) => {
    const name = args.name.trim();
    if (!name) throw new Error("name is required");

    const ctx = resolveScope();
    const guard = guardWrite({
      action: "rename-analysis",
      target: { kind: "analysis", id: args.id },
      caller: actionContext?.caller,
      scope: ctx,
      idempotencyKey: args.idempotencyKey,
      expectedUpdatedAt: args.expectedUpdatedAt,
      request: { name },
    });
    guard.requireKey();
    guard.requireFence();
    // Fenced through the retry helper: the patch below only ever touches
    // `name`, so a concurrent edit (e.g. save-analysis re-running with fresh
    // results) racing this rename is never silently overwritten — a lost
    // race just re-reads the freshest record and reapplies the rename. A
    // caller fence turns the re-read off: that race is the caller's conflict.
    const rename = () => ({ name });
    const outcome = await guard.run(
      () => requireAnalysisAccess(args.id, ctx, "editor"),
      () =>
        guard.active
          ? upsertAnalysisWithRetry(
              args.id,
              ctx,
              rename,
              undefined,
              guard.store,
            )
          : upsertAnalysisWithRetry(args.id, ctx, rename),
    );
    if ("replayed" in outcome) return { id: args.id, ...outcome.replayed };
    const analysis = outcome.written;
    return {
      id: analysis.id,
      name: analysis.name,
      ...guard.resultFields(analysis),
    };
  },
});
