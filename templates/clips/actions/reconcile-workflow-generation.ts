import { defineAction } from "@agent-native/core";
import {
  compareAndSetAppState,
  compareAndSetManyAppState,
  readAppState,
} from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { WorkflowKindSchema } from "../shared/workflow.js";

const WorkflowStateSchema = z
  .object({
    kind: WorkflowKindSchema.optional(),
    status: z.string().optional(),
    content: z.string().optional(),
    recordingId: z.string().optional(),
    requestedAt: z.string().optional(),
    tabId: z.string().optional(),
    claimedAt: z.string().optional(),
  })
  .passthrough();

const WorkflowRequestSchema = z
  .object({
    requestedAt: z.string(),
    deliveredAt: z.string().optional(),
    deliveredTabId: z.string().optional(),
  })
  .passthrough();

const CLAIM_LEASE_MS = 30_000;

export default defineAction({
  description:
    "Track and reconcile the agent run responsible for a generated workflow.",
  agentTool: false,
  schema: z.object({
    operation: z.enum([
      "track",
      "release",
      "mark-delivered",
      "consume",
      "stop",
    ]),
    recordingId: z.string().min(1),
    requestedAt: z.string().min(1),
    tabId: z.string().min(1),
  }),
  run: async ({ operation, recordingId, requestedAt, tabId }) => {
    await assertAccess("recording", recordingId, "viewer");

    const requestKey = `clips-ai-request-${recordingId}`;
    if (operation === "mark-delivered" || operation === "consume") {
      const rawRequest = await readAppState(requestKey);
      if (rawRequest === null) {
        return operation === "consume"
          ? { reconciled: false, consumed: true, reason: "missing" as const }
          : { reconciled: false, delivered: true, reason: "missing" as const };
      }
      const parsedRequest = WorkflowRequestSchema.safeParse(rawRequest);
      if (!parsedRequest.success) {
        throw new Error(`Invalid workflow request state for ${recordingId}`);
      }
      if (parsedRequest.data.requestedAt !== requestedAt) {
        return operation === "consume"
          ? {
              reconciled: false,
              consumed: true,
              reason: "newer-request" as const,
            }
          : {
              reconciled: false,
              delivered: true,
              reason: "newer-request" as const,
            };
      }
      if (operation === "mark-delivered") {
        if (parsedRequest.data.deliveredTabId === tabId) {
          return { reconciled: false, delivered: true };
        }
        if (parsedRequest.data.deliveredTabId) {
          return {
            reconciled: false,
            delivered: false,
            reason: "different-run" as const,
          };
        }

        const stateKey = `clips-workflow-${recordingId}`;
        const rawState = await readAppState(stateKey);
        if (rawState === null) {
          return { reconciled: false, delivered: false, reason: "missing" };
        }
        const parsedState = WorkflowStateSchema.safeParse(rawState);
        if (!parsedState.success) {
          throw new Error(
            `Invalid generated workflow state for ${recordingId}`,
          );
        }
        if (parsedState.data.status !== "generating") {
          const consumed = await compareAndSetAppState(
            requestKey,
            rawRequest,
            null,
          );
          return consumed
            ? {
                reconciled: false,
                delivered: true,
                consumed: true,
                reason: "terminal",
              }
            : {
                reconciled: false,
                delivered: false,
                consumed: false,
                reason: "stale",
              };
        }
        if (
          parsedState.data.requestedAt !== requestedAt ||
          parsedState.data.tabId !== tabId
        ) {
          return {
            reconciled: false,
            delivered: false,
            reason: "different-run",
          };
        }

        const deliveredAt = new Date().toISOString();
        const delivered = await compareAndSetManyAppState([
          {
            key: stateKey,
            expectedValue: rawState,
            nextValue: { ...rawState, claimedAt: deliveredAt },
          },
          {
            key: requestKey,
            expectedValue: rawRequest,
            nextValue: { ...rawRequest, deliveredAt, deliveredTabId: tabId },
          },
        ]);
        return delivered
          ? { reconciled: false, delivered: true }
          : { reconciled: false, delivered: false, reason: "stale" as const };
      }
      if (parsedRequest.data.deliveredTabId !== tabId) {
        return {
          reconciled: false,
          consumed: false,
          reason: "not-delivered" as const,
        };
      }
      const consumed = await compareAndSetAppState(
        requestKey,
        rawRequest,
        null,
      );
      return consumed
        ? { reconciled: false, consumed: true }
        : { reconciled: false, consumed: false, reason: "stale" as const };
    }

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
      if (state.tabId === tabId) {
        return { reconciled: false, tracked: true };
      }
      if (state.tabId) {
        const claimedAt = Date.parse(
          state.claimedAt ?? state.requestedAt ?? "",
        );
        if (
          !Number.isFinite(claimedAt) ||
          Date.now() - claimedAt < CLAIM_LEASE_MS
        ) {
          return {
            reconciled: false,
            tracked: false,
            reason: "claimed" as const,
          };
        }
      }
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

      const tracked = await compareAndSetAppState(stateKey, rawState, {
        ...rawState,
        tabId,
        claimedAt: new Date().toISOString(),
      });
      return tracked
        ? { reconciled: false, tracked: true }
        : { reconciled: false, tracked: false, reason: "stale" as const };
    }
    if (state.tabId !== tabId) {
      return operation === "release"
        ? {
            reconciled: false,
            released: true,
            reason: "different-run" as const,
          }
        : { reconciled: false, reason: "different-run" as const };
    }
    if (operation === "release") {
      const untrackedState = { ...rawState };
      delete untrackedState.tabId;
      delete untrackedState.claimedAt;
      const released = await compareAndSetAppState(
        stateKey,
        rawState,
        untrackedState,
      );
      return released
        ? { reconciled: false, released: true }
        : { reconciled: false, released: false, reason: "stale" as const };
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
