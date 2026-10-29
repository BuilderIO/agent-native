import { createHash } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import { getRequestContext } from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { trackDesign } from "../server/lib/design-tracking.js";
import getDesignGenerationOutput from "./get-design-generation-output.js";

const EXPERIMENT_ID = "design_first_output_next_step_v1";

export default defineAction({
  description:
    "Enroll the signed-in user in the first output next-step experiment.",
  schema: z.object({
    outputId: z.string().min(1),
    runId: z.string().min(1),
    turnId: z.string().min(1),
  }),
  outputSchema: z.object({
    variant: z.enum(["control", "next_step"]).nullable(),
  }),
  uiOnly: true,
  run: async (
    { outputId, runId, turnId },
    ctx,
  ): Promise<{ variant: "control" | "next_step" | null }> => {
    const authUserId = getRequestContext()?.authUserId;
    if (!authUserId) return { variant: null };
    const access = await resolveAccess("design", outputId);
    if (access?.role !== "owner") return { variant: null };
    const receipt = await getDesignGenerationOutput.run(
      {
        designId: outputId,
        runId,
        turnId,
      },
      ctx,
    );
    if (receipt.status !== "has_output") return { variant: null };
    const variant: "control" | "next_step" =
      createHash("sha256")
        .update(`${EXPERIMENT_ID}\0${authUserId}`)
        .digest()
        .readUInt8(0) < 128
        ? "control"
        : "next_step";
    const db = getDb();
    const inserted = await db
      .insert(schema.firstOutputExperimentClaims)
      .values({ userId: authUserId, variant, outputId, turnId })
      .onConflictDoNothing()
      .returning({ userId: schema.firstOutputExperimentClaims.userId });
    if (inserted.length === 0) {
      const records = await db
        .select()
        .from(schema.firstOutputExperimentClaims)
        .where(eq(schema.firstOutputExperimentClaims.userId, authUserId))
        .limit(1);
      const existing = records.find((row) => row.userId === authUserId);
      if (!existing)
        fail("Experiment assignment disappeared after enrollment", {
          errorCode: "experiment_assignment_missing",
        });
      if (existing.variant !== "control" && existing.variant !== "next_step")
        fail("Invalid experiment assignment", {
          errorCode: "experiment_assignment_invalid",
        });
      return {
        variant:
          existing.outputId === outputId && existing.turnId === turnId
            ? existing.variant
            : null,
      };
    }
    trackDesign(
      "first_output_next_step_exposed",
      {
        experiment_id: EXPERIMENT_ID,
        experiment_variant: variant,
        output_id: outputId,
        run_id: runId,
        turn_id: turnId,
        auth_user_id: authUserId,
      },
      ctx,
    );
    return { variant };
  },
});
