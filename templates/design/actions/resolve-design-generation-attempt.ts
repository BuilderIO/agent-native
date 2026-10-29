import { defineAction } from "@agent-native/core/action";
import {
  callerHasThreadAccess,
  getCurrentTurnRunIdsForThread,
  getRunStatus,
} from "@agent-native/core/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
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
    status: z.enum(["missing", "pending", "ready", "unavailable", "terminal"]),
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
    const userEmail = getRequestUserEmail()?.trim().toLowerCase();
    const orgId = getRequestOrgId();
    if (
      !userEmail ||
      !(await callerHasThreadAccess(userEmail, attempt.threadId, "viewer", {
        ...(orgId ? { orgId } : {}),
      }))
    ) {
      return { status: "unavailable" as const, result: null };
    }
    const runIds = await getCurrentTurnRunIdsForThread(
      attempt.threadId,
      attempt.turnId,
    );
    const latestRunId = runIds[runIds.length - 1];
    if (!latestRunId) return { status: "pending" as const, result: null };
    const status = await getRunStatus(latestRunId);
    if (
      status === "errored" ||
      status === "aborted" ||
      status === "truncated"
    ) {
      return { status: "terminal" as const, result: null };
    }
    if (status !== "completed")
      return { status: "pending" as const, result: null };
    const receipt = await getDesignGenerationOutput.run(
      { designId, runId: latestRunId, turnId: attempt.turnId },
      ctx,
    );
    if (receipt.status === "no_output")
      return { status: "terminal" as const, result: null };
    if (receipt.status === "has_output")
      return {
        status: "ready" as const,
        result: { runId: latestRunId, turnId: attempt.turnId },
      };

    return { status: "pending" as const, result: null };
  },
});
