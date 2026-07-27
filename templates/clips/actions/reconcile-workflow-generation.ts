import { defineAction } from "@agent-native/core";
import {
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

const WorkflowStateSchema = z
  .object({
    kind: z.enum(["pr", "sop", "ticket", "email"]).optional(),
    status: z.string().optional(),
    content: z.string().optional(),
    recordingId: z.string().optional(),
    requestedAt: z.string().optional(),
  })
  .passthrough();

export default defineAction({
  description:
    "Reconcile a generated workflow after its agent run ends without saving output.",
  agentTool: false,
  schema: z.object({
    recordingId: z.string().min(1),
    requestedAt: z.string().min(1),
  }),
  run: async ({ recordingId, requestedAt }) => {
    await assertAccess("recording", recordingId, "viewer");

    const stateKey = `clips-workflow-${recordingId}`;
    const rawState = await readAppState(stateKey);
    if (rawState === null) {
      return { reconciled: false, reason: "missing" as const };
    }

    const parsedState = WorkflowStateSchema.safeParse(rawState);
    if (!parsedState.success) {
      throw new Error(`Invalid generated workflow state for ${recordingId}`);
    }

    const state = parsedState.data;
    if (state.status !== "generating") {
      return { reconciled: false, reason: "terminal" as const };
    }
    if (state.requestedAt !== requestedAt) {
      return { reconciled: false, reason: "newer-request" as const };
    }

    await writeAppState(stateKey, {
      ...state,
      status: "failed",
      failedAt: new Date().toISOString(),
    });

    return { reconciled: true };
  },
});
