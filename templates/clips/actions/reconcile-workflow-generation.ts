import { defineAction } from "@agent-native/core";
import {
  compareAndSetAppState,
  compareAndSetManyAppState,
  readAppState,
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
    tabId: z.string().optional(),
  })
  .passthrough();

const WorkflowRequestSchema = z
  .object({ requestedAt: z.string() })
  .passthrough();

export default defineAction({
  description:
    "Track and reconcile the agent run responsible for a generated workflow.",
  agentTool: false,
  schema: z.object({
    operation: z.enum(["track", "stop"]),
    recordingId: z.string().min(1),
    requestedAt: z.string().min(1),
    tabId: z.string().min(1),
  }),
  run: async ({ operation, recordingId, requestedAt, tabId }) => {
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

    if (operation === "track") {
      const requestKey = `clips-ai-request-${recordingId}`;
      const rawRequest = await readAppState(requestKey);
      if (rawRequest === null) {
        return { reconciled: false, reason: "request-missing" as const };
      }
      const parsedRequest = WorkflowRequestSchema.safeParse(rawRequest);
      if (!parsedRequest.success) {
        throw new Error(`Invalid workflow request state for ${recordingId}`);
      }
      if (parsedRequest.data.requestedAt !== requestedAt) {
        return { reconciled: false, reason: "newer-request" as const };
      }

      const tracked = await compareAndSetManyAppState([
        {
          key: stateKey,
          expectedValue: rawState,
          nextValue: { ...rawState, tabId },
        },
        {
          key: requestKey,
          expectedValue: rawRequest,
          nextValue: null,
        },
      ]);
      return tracked
        ? { reconciled: false, tracked: true }
        : { reconciled: false, reason: "stale" as const };
    }
    if (state.tabId !== tabId) {
      return { reconciled: false, reason: "different-run" as const };
    }

    const reconciled = await compareAndSetAppState(stateKey, rawState, {
      ...rawState,
      status: "failed",
      failedAt: new Date().toISOString(),
    });
    return reconciled
      ? { reconciled: true }
      : { reconciled: false, reason: "stale" as const };
  },
});
