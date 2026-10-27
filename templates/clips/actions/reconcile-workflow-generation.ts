import { defineAction, fail } from "@agent-native/core/action";
import {
  compareAndSetAppState,
  compareAndSetManyAppState,
  readAppState,
} from "@agent-native/core/application-state";
import {
  abortTurnByRefDurably,
  getActiveRunForThreadAsync,
  getRunStatus,
  getRunTurnRef,
} from "@agent-native/core/server";
import { backgroundAgentTurnIdForReceipt } from "@agent-native/core/shared";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  matchesWorkflowRequest,
  workflowGenerationStaleAt,
  WorkflowKindSchema,
  workflowSessionTabId,
} from "../shared/workflow.js";

const WorkflowStateSchema = z
  .object({
    kind: WorkflowKindSchema.optional(),
    status: z.string().optional(),
    content: z.string().optional(),
    recordingId: z.string().optional(),
    requestedAt: z.string().optional(),
    requestId: z.string().min(1).optional(),
    requestedBy: z.string().optional(),
    tabId: z.string().optional(),
    claimedAt: z.string().optional(),
  })
  .passthrough();

const WorkflowRequestSchema = z
  .object({
    requestedAt: z.string(),
    requestId: z.string().min(1).optional(),
    deliveredAt: z.string().optional(),
    deliveredTabId: z.string().optional(),
  })
  .passthrough();

const CLAIM_LEASE_MS = 30_000;
const TERMINAL_RUN_STATUSES = [
  "completed",
  "truncated",
  "errored",
  "aborted",
] as const;

const isWorkflowRequester = (
  requestedBy: string | undefined,
  userEmail: string | undefined,
) =>
  requestedBy === undefined ||
  (userEmail !== undefined &&
    requestedBy.trim().toLowerCase() === userEmail.trim().toLowerCase());

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
      "settle",
      "settle-terminal",
      "reject",
      "stop",
    ]),
    recordingId: z.string().min(1),
    requestedAt: z.string().min(1),
    requestId: z.string().min(1).optional(),
    tabId: z.string().min(1),
    stopReason: z.enum(["cancelled", "timed_out"]).optional(),
    terminalRunId: z.string().min(1).optional(),
  }),
  run: async (
    {
      operation,
      recordingId,
      requestedAt,
      requestId,
      tabId,
      stopReason,
      terminalRunId,
    },
    ctx,
  ) => {
    if (stopReason !== undefined && operation !== "stop") {
      fail("A workflow stop reason is only valid when stopping a session", {
        errorCode: "invalid_workflow_generation_stop_reason",
        statusCode: 400,
      });
    }
    if (terminalRunId !== undefined && operation !== "settle-terminal") {
      fail("A terminal run ID is only valid when settling a terminal session", {
        errorCode: "invalid_workflow_generation_terminal_run",
        statusCode: 400,
      });
    }
    await assertAccess(
      "recording",
      recordingId,
      operation === "stop" ? "editor" : "viewer",
    );

    if (
      ["track", "settle", "settle-terminal", "reject", "stop"].includes(
        operation,
      ) &&
      tabId !== workflowSessionTabId(recordingId, requestedAt, requestId)
    ) {
      fail("Invalid workflow generation session", {
        errorCode: "invalid_workflow_generation_session",
        statusCode: 400,
      });
    }

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
      if (
        !matchesWorkflowRequest(parsedRequest.data, { requestedAt, requestId })
      ) {
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
      const stateKey = `clips-workflow-${recordingId}`;
      const rawState = await readAppState(stateKey);
      let workflowState: z.infer<typeof WorkflowStateSchema> | null = null;
      if (rawState !== null) {
        const parsedState = WorkflowStateSchema.safeParse(rawState);
        if (!parsedState.success) {
          // guard:allow-bare-error — invariant: Clips workflow actions write this state shape.
          throw new Error(
            `Invalid generated workflow state for ${recordingId}`,
          );
        }
        workflowState = parsedState.data;
        if (!isWorkflowRequester(workflowState.requestedBy, ctx?.userEmail)) {
          return operation === "consume"
            ? {
                reconciled: false,
                consumed: false,
                reason: "not-requester" as const,
              }
            : {
                reconciled: false,
                delivered: false,
                reason: "not-requester" as const,
              };
        }
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

        if (rawState === null || workflowState === null) {
          return { reconciled: false, delivered: false, reason: "missing" };
        }
        if (workflowState.status !== "generating") {
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
          !matchesWorkflowRequest(workflowState, { requestedAt, requestId }) ||
          workflowState.tabId !== tabId
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
    if (
      operation === "track" &&
      !isWorkflowRequester(state.requestedBy, ctx?.userEmail)
    ) {
      return { reconciled: false, reason: "not-requester" as const };
    }
    if (state.status !== "generating") {
      if (operation !== "track") {
        return { reconciled: false, reason: "terminal" as const };
      }
      // A run can finish or be failed by the session monitor before its
      // request was consumed; without this the bridge re-tracks it forever.
      const rawRequest = await readAppState(requestKey);
      if (rawRequest === null) {
        return {
          reconciled: false,
          tracked: false,
          consumed: true,
          reason: "terminal" as const,
        };
      }
      const parsedRequest = WorkflowRequestSchema.safeParse(rawRequest);
      if (!parsedRequest.success) {
        // guard:allow-bare-error — invariant: generate-workflow writes this shape
        throw new Error(`Invalid workflow request state for ${recordingId}`);
      }
      if (
        !matchesWorkflowRequest(parsedRequest.data, { requestedAt, requestId })
      ) {
        return {
          reconciled: false,
          tracked: false,
          consumed: true,
          reason: "terminal" as const,
        };
      }
      const consumed = await compareAndSetAppState(
        requestKey,
        rawRequest,
        null,
      );
      return {
        reconciled: false,
        tracked: false,
        consumed,
        reason: consumed ? ("terminal" as const) : ("stale" as const),
      };
    }
    if (!matchesWorkflowRequest(state, { requestedAt, requestId })) {
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
      if (
        !matchesWorkflowRequest(parsedRequest.data, { requestedAt, requestId })
      ) {
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
    const settlingUnclaimedWorkflow =
      operation === "settle" && state.tabId === undefined;
    if (
      operation !== "stop" &&
      state.tabId !== tabId &&
      !settlingUnclaimedWorkflow
    ) {
      return operation === "release"
        ? {
            reconciled: false,
            released: true,
            reason: "different-run" as const,
          }
        : { reconciled: false, reason: "different-run" as const };
    }
    if (operation === "reject") {
      const requesterEmail = ctx?.userEmail?.trim().toLowerCase();
      if (!requesterEmail || state.requestedBy !== requesterEmail) {
        return { reconciled: false, reason: "not-requester" as const };
      }

      const rawRequest = await readAppState(requestKey);
      if (rawRequest === null) {
        return { reconciled: false, reason: "request-missing" as const };
      }
      const parsedRequest = WorkflowRequestSchema.safeParse(rawRequest);
      if (!parsedRequest.success) {
        // guard:allow-bare-error — invariant: only Clips workflow actions write this state.
        throw new Error(`Invalid workflow request state for ${recordingId}`);
      }
      if (
        !matchesWorkflowRequest(parsedRequest.data, { requestedAt, requestId })
      ) {
        return { reconciled: false, reason: "newer-request" as const };
      }
      if (parsedRequest.data.deliveredAt || parsedRequest.data.deliveredTabId) {
        return { reconciled: false, reason: "delivered" as const };
      }

      const activeRun = await getActiveRunForThreadAsync(tabId);
      if (
        activeRun &&
        (activeRun.status === "running" ||
          activeRun.inFlight ||
          activeRun.awaitingRedispatch ||
          activeRun.hasInFlightWork)
      ) {
        return { reconciled: false, reason: "in-progress" as const };
      }
      if (
        activeRun &&
        !TERMINAL_RUN_STATUSES.includes(
          activeRun.status as (typeof TERMINAL_RUN_STATUSES)[number],
        )
      ) {
        return { reconciled: false, reason: "in-progress" as const };
      }

      const nextState = {
        ...rawState,
        status: "failed",
        failedAt: new Date().toISOString(),
        failureReason: "session-rejected",
      };
      const reconciled = await compareAndSetManyAppState([
        { key: stateKey, expectedValue: rawState, nextValue: nextState },
        { key: requestKey, expectedValue: rawRequest, nextValue: null },
      ]);
      return reconciled
        ? { reconciled: true }
        : { reconciled: false, reason: "stale" as const };
    }
    if (operation === "stop") {
      // Persisted claims can be stale; the canonical ID above scopes this abort.
      await abortTurnByRefDurably(
        tabId,
        backgroundAgentTurnIdForReceipt(tabId, tabId),
        stopReason ?? "workflow-session-ended",
      );
    }
    if (operation === "settle" || operation === "settle-terminal") {
      const activeRun = await getActiveRunForThreadAsync(tabId);
      const expireIfStale = async () => {
        const staleAt = workflowGenerationStaleAt(state);
        if (staleAt === null || staleAt > Date.now()) return null;

        const expiredState = {
          ...rawState,
          status: "failed",
          failedAt: new Date().toISOString(),
          failureReason: "session-expired",
        };
        const rawRequest = await readAppState(requestKey);
        if (rawRequest === null) {
          const reconciled = await compareAndSetAppState(
            stateKey,
            rawState,
            expiredState,
          );
          return reconciled
            ? { reconciled: true, expired: true }
            : { reconciled: false, reason: "stale" as const };
        }
        const parsedRequest = WorkflowRequestSchema.safeParse(rawRequest);
        if (!parsedRequest.success) {
          // guard:allow-bare-error — invariant: generate-workflow writes this shape.
          throw new Error(`Invalid workflow request state for ${recordingId}`);
        }
        if (
          !matchesWorkflowRequest(parsedRequest.data, {
            requestedAt,
            requestId,
          })
        ) {
          return { reconciled: false, reason: "newer-request" as const };
        }
        const reconciled = await compareAndSetManyAppState([
          { key: stateKey, expectedValue: rawState, nextValue: expiredState },
          { key: requestKey, expectedValue: rawRequest, nextValue: null },
        ]);
        return reconciled
          ? { reconciled: true, expired: true }
          : { reconciled: false, reason: "stale" as const };
      };
      if (!activeRun && operation === "settle") {
        return (
          (await expireIfStale()) ?? {
            reconciled: false,
            reason: "run-not-found" as const,
          }
        );
      }
      if (
        activeRun &&
        (activeRun.status === "running" ||
          activeRun.inFlight ||
          activeRun.awaitingRedispatch ||
          activeRun.hasInFlightWork)
      ) {
        return { reconciled: false, reason: "in-progress" as const };
      }
      if (
        activeRun &&
        !TERMINAL_RUN_STATUSES.includes(
          activeRun.status as (typeof TERMINAL_RUN_STATUSES)[number],
        )
      ) {
        return { reconciled: false, reason: "in-progress" as const };
      }
      if (operation === "settle-terminal") {
        if (!terminalRunId) {
          fail("A terminal run ID is required to settle a terminal session", {
            errorCode: "missing_workflow_generation_terminal_run",
            statusCode: 400,
          });
        }
        const [runRef, runStatus] = await Promise.all([
          getRunTurnRef(terminalRunId),
          getRunStatus(terminalRunId),
        ]);
        if (
          !runRef ||
          runRef.threadId !== tabId ||
          runRef.turnId !== backgroundAgentTurnIdForReceipt(tabId, tabId)
        ) {
          return (
            (await expireIfStale()) ?? {
              reconciled: false,
              reason: "run-not-found" as const,
            }
          );
        }
        if (
          !TERMINAL_RUN_STATUSES.includes(
            runStatus as (typeof TERMINAL_RUN_STATUSES)[number],
          )
        ) {
          return { reconciled: false, reason: "in-progress" as const };
        }
      }
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

    const nextState = {
      ...rawState,
      status: "failed",
      failedAt: new Date().toISOString(),
      ...(stopReason ? { failureReason: stopReason } : {}),
    };
    const reconciled = await compareAndSetAppState(
      stateKey,
      rawState,
      nextState,
    );
    return reconciled
      ? { reconciled: true }
      : { reconciled: false, reason: "stale" as const };
  },
});
