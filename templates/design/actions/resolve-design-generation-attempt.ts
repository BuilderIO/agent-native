import { defineAction } from "@agent-native/core/action";
import { getCurrentTurnRunIdsForThread } from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import getDesignGenerationOutput from "./get-design-generation-output.js";

export default defineAction({
  description:
    "Resolve a first-result link to a verified completed Design generation.",
  schema: z.object({
    designId: z.string().min(1),
    attemptId: z.string().min(1),
  }),
  outputSchema: z.object({
    status: z.enum(["missing", "pending", "ready", "unavailable"]),
    result: z.object({ runId: z.string(), turnId: z.string() }).nullable(),
  }),
  http: { method: "GET" },
  readOnly: true,
  uiOnly: true,
  agentTool: false,
  run: async ({ designId, attemptId }, ctx) => {
    const access = await resolveAccess("design", designId);
    if (access?.role !== "owner")
      return { status: "unavailable" as const, result: null };
    const attempts = await getDb()
      .select()
      .from(schema.designGenerationAttempts)
      .where(
        and(
          eq(schema.designGenerationAttempts.attemptId, attemptId),
          eq(schema.designGenerationAttempts.designId, designId),
        ),
      )
      .limit(1);
    const attempt = attempts.find((row) => row.designId === designId);
    if (!attempt) return { status: "missing" as const, result: null };
    const runIds = await getCurrentTurnRunIdsForThread(
      attempt.threadId,
      attempt.turnId,
    );
    for (const runId of runIds.reverse()) {
      const receipt = await getDesignGenerationOutput.run(
        { designId, runId, turnId: attempt.turnId },
        ctx,
      );
      if (receipt.status === "has_output")
        return {
          status: "ready" as const,
          result: { runId, turnId: attempt.turnId },
        };
    }
    return { status: "pending" as const, result: null };
  },
});
