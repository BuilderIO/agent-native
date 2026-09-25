import { defineAction, fail } from "@agent-native/core/action";
import {
  compareAndSetAppState,
  readAppState,
} from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { WorkflowKindSchema } from "../shared/workflow.js";

const WorkflowStateSchema = z
  .object({
    kind: WorkflowKindSchema.optional(),
    status: z.string(),
    recordingId: z.string().min(1),
    requestedAt: z.string().min(1),
  })
  .passthrough();

export default defineAction({
  description:
    "Save the final markdown for a Clips workflow request. Returns saved only after the matching request is persisted as ready.",
  schema: z.object({
    recordingId: z.string().min(1).describe("Recording that owns the workflow"),
    requestedAt: z
      .string()
      .min(1)
      .describe("Exact request timestamp from the generate-workflow context"),
    content: z
      .string()
      .trim()
      .min(1)
      .max(50_000)
      .describe("Final workflow document in markdown"),
  }),
  run: async ({ recordingId, requestedAt, content }) => {
    await assertAccess("recording", recordingId, "viewer");

    const stateKey = `clips-workflow-${recordingId}`;
    const current = await readAppState(stateKey);
    if (current === null) {
      fail("No active workflow request was found for this recording.", {
        statusCode: 409,
        errorCode: "workflow_not_active",
      });
    }

    const parsed = WorkflowStateSchema.safeParse(current);
    if (!parsed.success) {
      throw new Error(`Invalid generated workflow state for ${recordingId}`);
    }
    if (parsed.data.recordingId !== recordingId) {
      throw new Error(`Generated workflow state does not match ${recordingId}`);
    }
    if (parsed.data.requestedAt !== requestedAt) {
      fail("This workflow request has been replaced by a newer request.", {
        statusCode: 409,
        errorCode: "stale_workflow_request",
      });
    }

    if (parsed.data.status === "ready" && current.content === content) {
      return { saved: true, recordingId, requestedAt, alreadySaved: true };
    }
    if (parsed.data.status !== "generating") {
      fail("This workflow request is no longer generating.", {
        statusCode: 409,
        errorCode: "workflow_not_generating",
      });
    }

    const nextState = {
      ...current,
      status: "ready",
      content,
      completedAt: new Date().toISOString(),
    };
    const saved = await compareAndSetAppState(stateKey, current, nextState);
    if (!saved) {
      const latest = await readAppState(stateKey);
      if (
        latest?.status === "ready" &&
        latest.recordingId === recordingId &&
        latest.requestedAt === requestedAt &&
        latest.content === content
      ) {
        return { saved: true, recordingId, requestedAt, alreadySaved: true };
      }
      fail("The workflow changed before its result could be saved.", {
        statusCode: 409,
        errorCode: "workflow_changed",
      });
    }

    const persisted = await readAppState(stateKey);
    if (
      persisted?.status !== "ready" ||
      persisted.recordingId !== recordingId ||
      persisted.requestedAt !== requestedAt ||
      persisted.content !== content
    ) {
      throw new Error(
        `Generated workflow was not persisted for ${recordingId}`,
      );
    }

    return { saved: true, recordingId, requestedAt };
  },
});
