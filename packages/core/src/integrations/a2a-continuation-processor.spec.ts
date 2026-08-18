import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  appendA2AArtifactLinks,
  buildA2ARecoverableArtifactMessage,
} from "../a2a/artifact-response.js";
import type { A2AContinuation } from "./a2a-continuations-store.js";
import type { PlatformAdapter, PlatformDeliveryOptions } from "./types.js";

const claimA2AContinuationMock = vi.hoisted(() => vi.fn());
const claimDueA2AContinuationsMock = vi.hoisted(() => vi.fn(async () => []));
const recoverDueA2AContinuationIdsMock = vi.hoisted(() => vi.fn());
const listRecoverableA2ATasksMock = vi.hoisted(() => vi.fn());
const getPendingTaskMock = vi.hoisted(() => vi.fn());
const durableDispatchEnabledMock = vi.hoisted(() => vi.fn());
const dispatchPendingIntegrationTaskMock = vi.hoisted(() => vi.fn());
const getNextPendingTaskForThreadMock = vi.hoisted(() => vi.fn());
const getIntegrationCampaignForTaskMock = vi.hoisted(() => vi.fn());
const failDisabledIntegrationCampaignTaskMock = vi.hoisted(() => vi.fn());
const failIntegrationCampaignTaskDeliveryContainmentMock = vi.hoisted(() =>
  vi.fn(async () => true),
);
const completeIntegrationCampaignTaskAfterA2AMock = vi.hoisted(() =>
  vi.fn(async () => true),
);
const claimA2AContinuationDeliveryMock = vi.hoisted(() => vi.fn());
const completeA2AContinuationMock = vi.hoisted(() => vi.fn());
const recordA2ATerminalDeliveryReceiptMock = vi.hoisted(() => vi.fn());
const retainA2AUnconfirmedDeliveryClaimMock = vi.hoisted(() => vi.fn());
const getA2AContinuationTaskOutcomeMock = vi.hoisted(() =>
  vi.fn(async () => "terminal-delivered"),
);
const hasPendingConfirmedA2ADeliveryForIntegrationTaskMock = vi.hoisted(() =>
  vi.fn(async () => false),
);
const hasOnlyLegacyFailedA2AContinuationsForIntegrationTaskMock = vi.hoisted(
  () => vi.fn(async () => false),
);
const failA2AContinuationMock = vi.hoisted(() => vi.fn());
const failA2AContinuationsForIntegrationTaskMock = vi.hoisted(() => vi.fn());
const getA2AContinuationMock = vi.hoisted(() => vi.fn());
const rescheduleA2AContinuationMock = vi.hoisted(() => vi.fn());
const saveA2AVerifiedArtifactCheckpointMock = vi.hoisted(() => vi.fn());
const getTaskMock = vi.hoisted(() => vi.fn());
const signA2ATokenMock = vi.hoisted(() =>
  vi.fn(async () => "signed-a2a-token"),
);
const getThreadMappingMock = vi.hoisted(() => vi.fn());
const getThreadMock = vi.hoisted(() => vi.fn());
const updateThreadDataMock = vi.hoisted(() => vi.fn());
const A2AClientMock = vi.hoisted(() =>
  vi.fn().mockImplementation(function A2AClient() {
    return { getTask: getTaskMock };
  }),
);

vi.mock("./a2a-continuations-store.js", () => ({
  claimA2AContinuation: claimA2AContinuationMock,
  claimA2AContinuationDelivery: claimA2AContinuationDeliveryMock,
  claimDueA2AContinuations: claimDueA2AContinuationsMock,
  finalizeA2ATerminalHistory: completeA2AContinuationMock,
  failA2AContinuation: failA2AContinuationMock,
  failA2AContinuationsForIntegrationTask:
    failA2AContinuationsForIntegrationTaskMock,
  getA2AContinuation: getA2AContinuationMock,
  getA2AContinuationTaskOutcome: getA2AContinuationTaskOutcomeMock,
  hasPendingConfirmedA2ADeliveryForIntegrationTask:
    hasPendingConfirmedA2ADeliveryForIntegrationTaskMock,
  hasOnlyLegacyFailedA2AContinuationsForIntegrationTask:
    hasOnlyLegacyFailedA2AContinuationsForIntegrationTaskMock,
  listRecoverableA2AIntegrationTasks: listRecoverableA2ATasksMock,
  recoverDueA2AContinuationIds: recoverDueA2AContinuationIdsMock,
  recordA2ATerminalDeliveryReceipt: recordA2ATerminalDeliveryReceiptMock,
  retainA2AUnconfirmedDeliveryClaim: retainA2AUnconfirmedDeliveryClaimMock,
  rescheduleA2AContinuation: rescheduleA2AContinuationMock,
  saveA2AVerifiedArtifactCheckpoint: saveA2AVerifiedArtifactCheckpointMock,
}));

vi.mock("./pending-tasks-store.js", () => ({
  getPendingTask: getPendingTaskMock,
  getNextPendingTaskForThread: getNextPendingTaskForThreadMock,
}));

vi.mock("./integration-durable-dispatch.js", () => ({
  isIntegrationDurableDispatchEnabledForTask: durableDispatchEnabledMock,
  dispatchPendingIntegrationTask: dispatchPendingIntegrationTaskMock,
}));

vi.mock("./integration-campaigns-store.js", () => ({
  completeIntegrationCampaignTaskAfterA2A:
    completeIntegrationCampaignTaskAfterA2AMock,
  getIntegrationCampaignForTask: getIntegrationCampaignForTaskMock,
  failDisabledIntegrationCampaignTask: failDisabledIntegrationCampaignTaskMock,
  failIntegrationCampaignTaskDeliveryContainment:
    failIntegrationCampaignTaskDeliveryContainmentMock,
}));

vi.mock("../server/core-routes-plugin.js", () => ({
  FRAMEWORK_ROUTE_PREFIX: "/_agent-native",
}));

vi.mock("../a2a/client.js", () => ({
  A2AClient: A2AClientMock,
  shouldPreferGlobalA2ASecret: (orgSecret?: string) =>
    !!process.env.A2A_SECRET?.trim() || !orgSecret,
  signA2AToken: signA2ATokenMock,
}));

vi.mock("./internal-token.js", () => ({
  signInternalToken: vi.fn(() => "signed-internal-token"),
}));

vi.mock("./thread-mapping-store.js", () => ({
  getThreadMapping: getThreadMappingMock,
}));

vi.mock("../chat-threads/store.js", () => ({
  getThread: getThreadMock,
  updateThreadData: updateThreadDataMock,
}));

function continuation(
  overrides: Partial<A2AContinuation> = {},
): A2AContinuation {
  const now = Date.now();
  return {
    id: "cont-1",
    integrationTaskId: "task-1",
    platform: "slack",
    externalThreadId: "C123:123.456",
    incoming: {
      platform: "slack",
      externalThreadId: "C123:123.456",
      text: "make a deck",
      timestamp: 1,
      platformContext: { channelId: "C123", threadTs: "123.456" },
    },
    placeholderRef: null,
    progressRef: null,
    progressRefClaimed: false,
    ownerEmail: "alice+qa@agent-native.test",
    orgId: null,
    agentName: "Slides",
    agentUrl: "https://slides.agent-native.test",
    a2aTaskId: "a2a-task-1",
    a2aAuthToken: null,
    verifiedArtifactCheckpoint: null,
    terminalDeliveryKind: null,
    terminalDeliveryConfirmedAt: null,
    terminalHistoryPayload: null,
    status: "processing",
    attempts: 1,
    nextCheckAt: 1,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    ...overrides,
  };
}

function adapter(
  sendResponse = vi.fn(async () => ({ status: "delivered" as const })),
): PlatformAdapter {
  return {
    platform: "slack",
    label: "Slack",
    getRequiredEnvKeys: () => [],
    handleVerification: async () => ({ handled: false }),
    verifyWebhook: async () => true,
    parseIncomingMessage: async () => null,
    sendResponse,
    sendMessageToTarget: async () => undefined,
    formatAgentResponse: (text) => ({ text, platformContext: {} }),
    getStatus: async () => ({
      platform: "slack",
      label: "Slack",
      enabled: true,
      configured: true,
    }),
  };
}

describe("A2A continuation processor", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      APP_URL: "https://dispatch.agent-native.test",
    };
    getA2AContinuationMock.mockImplementation(async (id: string) =>
      continuation({ id, status: "pending" }),
    );
    completeA2AContinuationMock.mockResolvedValue(undefined);
    getA2AContinuationTaskOutcomeMock.mockResolvedValue("terminal-delivered");
    hasPendingConfirmedA2ADeliveryForIntegrationTaskMock.mockResolvedValue(
      false,
    );
    hasOnlyLegacyFailedA2AContinuationsForIntegrationTaskMock.mockResolvedValue(
      false,
    );
    failA2AContinuationMock.mockResolvedValue(undefined);
    recordA2ATerminalDeliveryReceiptMock.mockImplementation(
      async (
        id: string,
        kind: "success" | "failure",
        terminalHistoryPayload: A2AContinuation["terminalHistoryPayload"],
        errorMessage?: string,
      ) =>
        continuation({
          id,
          status: "delivering",
          terminalDeliveryKind: kind,
          terminalDeliveryConfirmedAt: Date.now(),
          terminalHistoryPayload,
          errorMessage: errorMessage ?? null,
        }),
    );
    retainA2AUnconfirmedDeliveryClaimMock.mockResolvedValue(undefined);
    rescheduleA2AContinuationMock.mockResolvedValue(undefined);
    saveA2AVerifiedArtifactCheckpointMock.mockImplementation(
      async (_id: string, checkpoint: string) => checkpoint,
    );
    getThreadMappingMock.mockResolvedValue({
      internalThreadId: "thread-123",
    });
    getThreadMock.mockResolvedValue({
      id: "thread-123",
      title: "Slack thread",
      preview: "Integration request",
      threadData: JSON.stringify({ messages: [] }),
    });
    updateThreadDataMock.mockResolvedValue(undefined);
    claimA2AContinuationDeliveryMock.mockImplementation(async (id: string) =>
      continuation({ id, status: "delivering" }),
    );
    claimDueA2AContinuationsMock.mockResolvedValue([]);
    recoverDueA2AContinuationIdsMock.mockResolvedValue([]);
    listRecoverableA2ATasksMock.mockResolvedValue([
      {
        id: "task-1",
        platform: "slack",
        externalThreadId: "slack:team:C123:1",
        dispatchScope: "C123",
        status: "processing",
        hasPendingConfirmedDelivery: false,
      },
      {
        id: "task-2",
        platform: "slack",
        externalThreadId: "slack:team:C123:2",
        dispatchScope: "C123",
        status: "processing",
        hasPendingConfirmedDelivery: false,
      },
    ]);
    getPendingTaskMock.mockResolvedValue({
      id: "task-1",
      platform: "slack",
      externalThreadId: "slack:team:C123:1",
      status: "processing",
    });
    durableDispatchEnabledMock.mockReturnValue(true);
    getIntegrationCampaignForTaskMock.mockResolvedValue(null);
    getNextPendingTaskForThreadMock.mockResolvedValue(null);
    dispatchPendingIntegrationTaskMock.mockResolvedValue(
      "background-acknowledged",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok", { status: 200 })),
    );
    getTaskMock.mockResolvedValue({
      id: "a2a-task-1",
      status: {
        state: "completed",
        message: {
          role: "agent",
          parts: [{ type: "text", text: "/deck/deck-qa" }],
        },
        timestamp: new Date().toISOString(),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.doUnmock("../org/context.js");
    process.env = originalEnv;
  });

  // CI's slower transform/import phase pushes the import of the processor
  // module into the per-test budget; bump to 15s so the 2s fake-timer
  // advance + module load doesn't get clipped by the default 5s timeout.
  it(
    "dispatches without aborting a long-running processor request",
    { timeout: 15000 },
    async () => {
      vi.useFakeTimers();
      vi.stubGlobal(
        "fetch",
        vi.fn(() => new Promise<Response>(() => {})),
      );
      const { dispatchA2AContinuation } =
        await import("./a2a-continuation-processor.js");

      const dispatch = dispatchA2AContinuation(
        "cont-long",
        "https://dispatch.agent-native.test",
      );

      expect(fetch).toHaveBeenCalledWith(
        "https://dispatch.agent-native.test/_agent-native/integrations/process-a2a-continuation",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ continuationId: "cont-long" }),
        }),
      );
      expect((vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).signal).toBe(
        undefined,
      );

      await vi.advanceTimersByTimeAsync(2_000);
      await dispatch;
    },
  );

  it("self-dispatches to this deploy, not production, on a deploy preview", async () => {
    // This resolver used to carry its own chain: it never read
    // DEPLOY_PRIME_URL, so a preview POSTed the continuation to production.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WEBHOOK_BASE_URL", "");
    vi.stubEnv("DEPLOY_PRIME_URL", "https://preview--app.netlify.app");
    vi.stubEnv("APP_URL", "https://app.example.com");
    vi.stubEnv("URL", "");
    vi.stubEnv("DEPLOY_URL", "");
    vi.stubEnv("BETTER_AUTH_URL", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 202 })),
    );
    const { dispatchA2AContinuation } =
      await import("./a2a-continuation-processor.js");

    await dispatchA2AContinuation("cont-preview");

    expect(fetch).toHaveBeenCalledWith(
      "https://preview--app.netlify.app/_agent-native/integrations/process-a2a-continuation",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("refuses to silently dispatch to localhost in production", async () => {
    // The old fallback was `http://localhost:${PORT}`, where the request never
    // arrives and the continuation is dropped with no error anywhere.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WEBHOOK_BASE_URL", "");
    vi.stubEnv("DEPLOY_PRIME_URL", "");
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("URL", "");
    vi.stubEnv("DEPLOY_URL", "");
    vi.stubEnv("BETTER_AUTH_URL", "");
    const { dispatchA2AContinuation } =
      await import("./a2a-continuation-processor.js");

    await expect(dispatchA2AContinuation("cont-nowhere")).rejects.toThrow(
      /requires DEPLOY_PRIME_URL/,
    );
  });

  it("recovers a bounded due batch by waking processors without claiming or polling", async () => {
    recoverDueA2AContinuationIdsMock.mockResolvedValue([
      "cont-due-1",
      "cont-due-2",
    ]);
    const { recoverDueA2AContinuations } =
      await import("./a2a-continuation-processor.js");

    await expect(recoverDueA2AContinuations({ limit: 2 })).resolves.toEqual({
      dispatched: 2,
      failed: 0,
    });

    expect(recoverDueA2AContinuationIdsMock).toHaveBeenCalledWith(2, [
      "task-1",
      "task-2",
    ]);
    expect(claimA2AContinuationMock).not.toHaveBeenCalled();
    expect(getTaskMock).not.toHaveBeenCalled();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch)).toHaveBeenNthCalledWith(
      1,
      "https://dispatch.agent-native.test/_agent-native/integrations/process-a2a-continuation",
      expect.objectContaining({
        body: JSON.stringify({ continuationId: "cont-due-1" }),
      }),
    );
  });

  it("releases an escaped processor failure for durable retry below the attempt bound", async () => {
    getA2AContinuationMock.mockResolvedValueOnce(
      continuation({ status: "processing", attempts: 2 }),
    );
    const { recoverA2AContinuationAfterProcessorFailure } =
      await import("./a2a-continuation-processor.js");

    await recoverA2AContinuationAfterProcessorFailure("cont-1", {
      adapters: new Map([["slack", adapter()]]),
      reason: "temporary database outage",
    });

    expect(rescheduleA2AContinuationMock).toHaveBeenCalledWith(
      "cont-1",
      20_000,
    );
    expect(fetch).toHaveBeenCalled();
    expect(failA2AContinuationMock).not.toHaveBeenCalled();
  });

  it("continues a due batch when one processor and its recovery both fail", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    claimDueA2AContinuationsMock.mockResolvedValueOnce([
      continuation({ id: "cont-failing" }),
      continuation({ id: "cont-healthy", a2aTaskId: "a2a-task-healthy" }),
    ]);
    getIntegrationCampaignForTaskMock
      .mockRejectedValueOnce(new Error("campaign database unavailable"))
      .mockResolvedValue(null);
    getA2AContinuationMock.mockRejectedValueOnce(
      new Error("recovery database unavailable"),
    );
    const { processDueA2AContinuations } =
      await import("./a2a-continuation-processor.js");

    await expect(
      processDueA2AContinuations({
        adapters: new Map([["slack", adapter()]]),
      }),
    ).resolves.toBeUndefined();

    expect(getTaskMock).toHaveBeenCalledWith("a2a-task-healthy");
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("recovery failed"),
      "Error",
    );
  });

  it("delivers the durable checkpoint when an escaped processor failure exhausts attempts", async () => {
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    getA2AContinuationMock.mockResolvedValueOnce(
      continuation({
        status: "processing",
        attempts: 30,
        verifiedArtifactCheckpoint: "Verified Content: /page/content-1",
      }),
    );
    claimA2AContinuationDeliveryMock.mockResolvedValueOnce(
      continuation({ status: "delivering", attempts: 30 }),
    );
    const { recoverA2AContinuationAfterProcessorFailure } =
      await import("./a2a-continuation-processor.js");

    await recoverA2AContinuationAfterProcessorFailure("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
      reason: "processor failed after mutation",
    });

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("/page/content-1"),
      }),
      expect.any(Object),
      expect.objectContaining({ placeholderRef: undefined }),
    );
    expect(completeA2AContinuationMock).toHaveBeenCalledWith("cont-1");
    expect(failA2AContinuationMock).not.toHaveBeenCalled();
  });

  it("bounds exhausted recovery when its platform adapter is unavailable", async () => {
    getA2AContinuationMock.mockResolvedValueOnce(
      continuation({ status: "processing", attempts: 30 }),
    );
    const { recoverA2AContinuationAfterProcessorFailure } =
      await import("./a2a-continuation-processor.js");

    await recoverA2AContinuationAfterProcessorFailure("cont-1", {
      adapters: new Map(),
      reason: "processor failed after its adapter was removed",
    });

    expect(failA2AContinuationsForIntegrationTaskMock).toHaveBeenCalledWith(
      "task-1",
      "Unknown platform: slack",
    );
    expect(
      failIntegrationCampaignTaskDeliveryContainmentMock,
    ).toHaveBeenCalledWith("task-1", "Unknown platform: slack");
    expect(rescheduleA2AContinuationMock).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves confirmed sibling custody when adapter exhaustion contains another sibling", async () => {
    getA2AContinuationMock.mockResolvedValueOnce(
      continuation({ status: "processing", attempts: 30 }),
    );
    hasPendingConfirmedA2ADeliveryForIntegrationTaskMock.mockResolvedValueOnce(
      true,
    );
    const { recoverA2AContinuationAfterProcessorFailure } =
      await import("./a2a-continuation-processor.js");

    await recoverA2AContinuationAfterProcessorFailure("cont-1", {
      adapters: new Map(),
      reason: "processor failed after its adapter was removed",
    });

    expect(failA2AContinuationsForIntegrationTaskMock).toHaveBeenCalledWith(
      "task-1",
      "Unknown platform: slack",
    );
    expect(
      failIntegrationCampaignTaskDeliveryContainmentMock,
    ).not.toHaveBeenCalled();
    expect(dispatchPendingIntegrationTaskMock).toHaveBeenCalledWith({
      taskId: "task-1",
      task: {
        platform: "slack",
        externalThreadId: "C123:123.456",
        platformContext: { channelId: "C123", threadTs: "123.456" },
      },
      campaignContinuation: true,
      allowPortableConfirmedReceiptReconciliation: true,
    });
  });

  it("allows one durable wake-up dispatch failure without stranding the rest", async () => {
    recoverDueA2AContinuationIdsMock.mockResolvedValue([
      "cont-fail",
      "cont-healthy",
    ]);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("example dispatch outage"))
        .mockResolvedValueOnce(new Response("ok", { status: 200 })),
    );
    const { recoverDueA2AContinuations } =
      await import("./a2a-continuation-processor.js");

    await expect(recoverDueA2AContinuations()).resolves.toEqual({
      dispatched: 2,
      failed: 0,
    });

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    expect(claimA2AContinuationMock).not.toHaveBeenCalled();
  });

  it("does not recover A2A work outside the durable canary scope", async () => {
    durableDispatchEnabledMock.mockReturnValue(false);
    recoverDueA2AContinuationIdsMock.mockResolvedValue([]);
    const { recoverDueA2AContinuations } =
      await import("./a2a-continuation-processor.js");

    await expect(recoverDueA2AContinuations()).resolves.toEqual({
      dispatched: 0,
      failed: 0,
    });
    expect(recoverDueA2AContinuationIdsMock).toHaveBeenCalledWith(5, []);
    expect(failA2AContinuationsForIntegrationTaskMock).toHaveBeenCalledTimes(2);
    expect(failDisabledIntegrationCampaignTaskMock).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("still wakes receipt-confirmed history when the rollout scope is disabled", async () => {
    durableDispatchEnabledMock.mockReturnValue(false);
    listRecoverableA2ATasksMock.mockResolvedValueOnce([
      {
        id: "task-confirmed",
        platform: "slack",
        externalThreadId: "slack:team:C123:confirmed",
        dispatchScope: "C123",
        status: "processing",
        hasPendingConfirmedDelivery: true,
      },
    ]);
    recoverDueA2AContinuationIdsMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(["cont-confirmed"]);
    const { recoverDueA2AContinuations } =
      await import("./a2a-continuation-processor.js");

    await expect(recoverDueA2AContinuations()).resolves.toEqual({
      dispatched: 1,
      failed: 0,
    });

    expect(recoverDueA2AContinuationIdsMock).toHaveBeenNthCalledWith(1, 5, []);
    expect(recoverDueA2AContinuationIdsMock).toHaveBeenNthCalledWith(
      2,
      5,
      ["task-confirmed"],
      true,
    );
    expect(failA2AContinuationsForIntegrationTaskMock).not.toHaveBeenCalled();
    expect(failDisabledIntegrationCampaignTaskMock).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("surfaces a durable-store failure for the next scheduler run", async () => {
    recoverDueA2AContinuationIdsMock.mockRejectedValueOnce(
      new Error("example database timeout"),
    );
    const { recoverDueA2AContinuations } =
      await import("./a2a-continuation-processor.js");

    await expect(recoverDueA2AContinuations()).rejects.toThrow(
      "example database timeout",
    );
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("fails a claimed durable continuation closed when its rollout scope is removed", async () => {
    const claimed = continuation();
    claimA2AContinuationMock.mockResolvedValueOnce(claimed);
    getIntegrationCampaignForTaskMock.mockResolvedValueOnce({
      id: "campaign-1",
      status: "waiting",
    });
    getPendingTaskMock.mockResolvedValueOnce({
      id: claimed.integrationTaskId,
      platform: "slack",
      externalThreadId: claimed.externalThreadId,
      dispatchScope: "C123",
      status: "processing",
    });
    durableDispatchEnabledMock.mockReturnValueOnce(false);
    getNextPendingTaskForThreadMock.mockResolvedValueOnce({
      id: "task-2",
      dispatchScope: "C999",
    });
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById(claimed.id, {
      adapters: new Map([["slack", adapter()]]),
    });

    expect(failA2AContinuationsForIntegrationTaskMock).toHaveBeenCalledWith(
      claimed.integrationTaskId,
      expect.stringContaining("disabled"),
    );
    expect(failDisabledIntegrationCampaignTaskMock).toHaveBeenCalledWith(
      claimed.integrationTaskId,
      expect.stringContaining("disabled"),
    );
    expect(getTaskMock).not.toHaveBeenCalled();
    expect(dispatchPendingIntegrationTaskMock).toHaveBeenCalledWith({
      taskId: "task-2",
      task: {
        platform: "slack",
        externalThreadId: claimed.externalThreadId,
        platformContext: { channelId: "C999" },
      },
    });
  });

  it("cancels only an unconfirmed sibling while confirmed history still owns custody", async () => {
    const claimed = continuation({ id: "cont-unconfirmed" });
    claimA2AContinuationMock.mockResolvedValueOnce(claimed);
    getIntegrationCampaignForTaskMock.mockResolvedValueOnce({
      id: "campaign-1",
      status: "waiting",
    });
    durableDispatchEnabledMock.mockReturnValue(false);
    hasPendingConfirmedA2ADeliveryForIntegrationTaskMock.mockResolvedValueOnce(
      true,
    );
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById(claimed.id, {
      adapters: new Map([["slack", adapter()]]),
    });

    expect(failA2AContinuationMock).toHaveBeenCalledWith(
      "cont-unconfirmed",
      expect.stringContaining("disabled before this continuation delivered"),
    );
    expect(failA2AContinuationsForIntegrationTaskMock).not.toHaveBeenCalled();
    expect(failDisabledIntegrationCampaignTaskMock).not.toHaveBeenCalled();
    expect(getTaskMock).not.toHaveBeenCalled();
  });

  it("finishes confirmed sibling history before closing a disabled mixed parent", async () => {
    claimA2AContinuationMock.mockResolvedValueOnce(
      continuation({
        id: "cont-confirmed",
        status: "processing",
        terminalDeliveryKind: "success",
        terminalDeliveryConfirmedAt: Date.now(),
        terminalHistoryPayload: {
          text: "Created /page/content-1",
          deliveredAt: new Date().toISOString(),
          messageRefs: ["slack-message-1"],
          artifacts: [],
        },
      }),
    );
    getIntegrationCampaignForTaskMock.mockResolvedValue({
      id: "campaign-1",
      integrationTaskId: "task-1",
      status: "waiting",
    });
    getA2AContinuationTaskOutcomeMock.mockResolvedValue(
      "terminal-without-delivery",
    );
    durableDispatchEnabledMock.mockReturnValue(false);
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-confirmed", { adapters: new Map() });

    expect(completeA2AContinuationMock).toHaveBeenCalledWith("cont-confirmed");
    expect(failDisabledIntegrationCampaignTaskMock).toHaveBeenCalledWith(
      "task-1",
      expect.stringContaining("disabled"),
    );
    expect(getTaskMock).not.toHaveBeenCalled();
  });

  it("repairs a disabled terminal-without-delivery parent on re-entry", async () => {
    getA2AContinuationTaskOutcomeMock.mockResolvedValue(
      "terminal-without-delivery",
    );
    durableDispatchEnabledMock.mockReturnValue(false);
    const { reconcileTerminalA2AParentIfDisabled } =
      await import("./a2a-continuation-processor.js");

    await expect(reconcileTerminalA2AParentIfDisabled("task-1")).resolves.toBe(
      true,
    );

    expect(failA2AContinuationsForIntegrationTaskMock).toHaveBeenCalledWith(
      "task-1",
      expect.stringContaining("disabled"),
    );
    expect(failDisabledIntegrationCampaignTaskMock).toHaveBeenCalledWith(
      "task-1",
      expect.stringContaining("disabled"),
    );
  });

  it("conservatively fails a waiting parent for ambiguous legacy failed rows", async () => {
    getA2AContinuationTaskOutcomeMock.mockResolvedValue(
      "terminal-without-delivery",
    );
    hasOnlyLegacyFailedA2AContinuationsForIntegrationTaskMock.mockResolvedValue(
      true,
    );
    durableDispatchEnabledMock.mockReturnValue(true);
    const { reconcileTerminalA2AParentIfDisabled } =
      await import("./a2a-continuation-processor.js");

    await expect(reconcileTerminalA2AParentIfDisabled("task-1")).resolves.toBe(
      true,
    );

    expect(
      failIntegrationCampaignTaskDeliveryContainmentMock,
    ).toHaveBeenCalledWith(
      "task-1",
      expect.stringContaining("Legacy A2A continuation"),
    );
    expect(failDisabledIntegrationCampaignTaskMock).not.toHaveBeenCalled();
  });

  it.each(["failed", "completed"] as const)(
    "does not poll an A2A row after its owning campaign is %s",
    async (status) => {
      const claimed = continuation();
      claimA2AContinuationMock.mockResolvedValueOnce(claimed);
      getIntegrationCampaignForTaskMock.mockResolvedValueOnce({
        id: "campaign-1",
        status,
      });
      const { processA2AContinuationById } =
        await import("./a2a-continuation-processor.js");

      await processA2AContinuationById(claimed.id, {
        adapters: new Map([["slack", adapter()]]),
      });

      expect(failA2AContinuationMock).toHaveBeenCalledWith(
        claimed.id,
        expect.stringContaining("terminal"),
      );
      expect(getTaskMock).not.toHaveBeenCalled();
    },
  );

  it("logs when the continuation processor route rejects dispatch", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("bad continuation token", {
            status: 401,
            statusText: "Unauthorized",
          }),
      ),
    );
    const { dispatchA2AContinuation } =
      await import("./a2a-continuation-processor.js");

    await dispatchA2AContinuation(
      "cont-rejected",
      "https://dispatch.agent-native.test",
    );

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining(
        "A2A continuation cont-rejected processor dispatch returned HTTP 401 Unauthorized: bad continuation token",
      ),
    );
  });

  it("posts completed remote task text and marks the continuation completed", async () => {
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    claimA2AContinuationMock.mockResolvedValueOnce(continuation());
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "https://slides.agent-native.test/deck/deck-qa",
      }),
      expect.any(Object),
      {
        idempotencyKey: "a2a-continuation:cont-1",
        reconcileAfter: expect.any(Number),
        signal: expect.any(AbortSignal),
        placeholderRef: undefined,
        strictTargetRef: true,
      },
    );
    expect(completeA2AContinuationMock).toHaveBeenCalledWith("cont-1");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retains the successful delivery claim when its receipt cannot be recorded", async () => {
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    claimA2AContinuationMock.mockResolvedValueOnce(continuation());
    recordA2ATerminalDeliveryReceiptMock.mockRejectedValue(
      new Error("receipt database unavailable"),
    );
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(sendResponse).toHaveBeenCalledOnce();
    expect(recordA2ATerminalDeliveryReceiptMock).toHaveBeenCalledTimes(3);
    expect(retainA2AUnconfirmedDeliveryClaimMock).toHaveBeenCalledWith(
      "cont-1",
    );
    expect(rescheduleA2AContinuationMock).not.toHaveBeenCalled();
    expect(completeA2AContinuationMock).not.toHaveBeenCalled();
  });

  it("reuses one provider delivery identity after Slack succeeds but receipt persistence fails", async () => {
    const providerDeliveries = new Set<string>();
    let visibleProviderDeliveries = 0;
    const sendResponse = vi.fn(
      async (
        _message: unknown,
        _incoming: unknown,
        opts?: PlatformDeliveryOptions,
      ) => {
        if (!opts?.idempotencyKey) throw new Error("missing idempotency key");
        if (!providerDeliveries.has(opts.idempotencyKey)) {
          visibleProviderDeliveries += 1;
        }
        providerDeliveries.add(opts.idempotencyKey);
        return {
          status: "delivered" as const,
          messageRefs: [opts.idempotencyKey],
        };
      },
    );
    claimA2AContinuationMock
      .mockResolvedValueOnce(continuation())
      .mockResolvedValueOnce(continuation());
    recordA2ATerminalDeliveryReceiptMock
      .mockRejectedValueOnce(new Error("receipt database unavailable"))
      .mockRejectedValueOnce(new Error("receipt database unavailable"))
      .mockRejectedValueOnce(new Error("receipt database unavailable"));
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });
    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(sendResponse).toHaveBeenCalledTimes(2);
    expect(providerDeliveries).toEqual(new Set(["a2a-continuation:cont-1"]));
    expect(visibleProviderDeliveries).toBe(1);
    expect(retainA2AUnconfirmedDeliveryClaimMock).toHaveBeenCalledOnce();
    expect(completeA2AContinuationMock).toHaveBeenCalledOnce();
  });

  it("closes the waiting parent campaign and wakes its successor after the last A2A reply", async () => {
    const claimed = continuation();
    claimA2AContinuationMock.mockResolvedValueOnce(claimed);
    getIntegrationCampaignForTaskMock.mockResolvedValue({
      id: "campaign-1",
      integrationTaskId: claimed.integrationTaskId,
      status: "waiting",
    });
    getNextPendingTaskForThreadMock.mockResolvedValueOnce({
      id: "task-2",
      dispatchScope: "C999",
    });
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById(claimed.id, {
      adapters: new Map([["slack", adapter()]]),
    });

    expect(completeA2AContinuationMock).toHaveBeenCalledWith(claimed.id);
    expect(completeIntegrationCampaignTaskAfterA2AMock).toHaveBeenCalledWith(
      claimed.integrationTaskId,
    );
    expect(dispatchPendingIntegrationTaskMock).toHaveBeenCalledWith({
      taskId: "task-2",
      task: {
        platform: "slack",
        externalThreadId: claimed.externalThreadId,
        platformContext: { channelId: "C999" },
      },
    });
  });

  it("keeps the parent campaign waiting while a sibling A2A continuation remains active", async () => {
    const claimed = continuation();
    claimA2AContinuationMock.mockResolvedValueOnce(claimed);
    getIntegrationCampaignForTaskMock.mockResolvedValue({
      id: "campaign-1",
      integrationTaskId: claimed.integrationTaskId,
      status: "waiting",
    });
    getA2AContinuationTaskOutcomeMock.mockResolvedValueOnce("active");
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById(claimed.id, {
      adapters: new Map([["slack", adapter()]]),
    });

    expect(completeA2AContinuationMock).toHaveBeenCalledWith(claimed.id);
    expect(completeIntegrationCampaignTaskAfterA2AMock).not.toHaveBeenCalled();
    expect(dispatchPendingIntegrationTaskMock).not.toHaveBeenCalled();
  });

  it("rechecks durable scope immediately before claiming terminal delivery", async () => {
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    const claimed = continuation();
    claimA2AContinuationMock.mockResolvedValueOnce(claimed);
    getIntegrationCampaignForTaskMock.mockResolvedValue({
      id: "campaign-1",
      integrationTaskId: claimed.integrationTaskId,
      status: "processing",
    });
    durableDispatchEnabledMock
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById(claimed.id, {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(claimA2AContinuationDeliveryMock).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
    expect(failDisabledIntegrationCampaignTaskMock).toHaveBeenCalledWith(
      claimed.integrationTaskId,
      expect.stringContaining("disabled"),
    );
  });

  it("persists confirmed continuation delivery and stable artifact identity", async () => {
    process.env.A2A_SECRET = "test-a2a-secret-for-continuation-history";
    const downstream = appendA2AArtifactLinks(
      "Created the request.",
      [
        {
          tool: "submit-content-database-form",
          result: JSON.stringify({
            createdDocumentId: "request_123",
            createdDocumentTitle: "Launch request",
            urlPath: "/page/request_123",
            verification: { found: true },
          }),
        },
      ],
      {
        baseUrl: "https://content.agent-native.test",
        includePersistedArtifactMarker: true,
      },
    );
    getTaskMock.mockResolvedValueOnce({
      id: "a2a-task-1",
      status: {
        state: "completed",
        message: {
          role: "agent",
          parts: [{ type: "text", text: downstream }],
        },
        timestamp: new Date().toISOString(),
      },
    });
    getThreadMappingMock.mockResolvedValueOnce({
      internalThreadId: "thread-123",
    });
    getThreadMock.mockResolvedValueOnce({
      id: "thread-123",
      title: "Slack thread",
      preview: "Create the request",
      threadData: JSON.stringify({ messages: [] }),
    });
    const sendResponse = vi.fn(async () => ({
      status: "delivered" as const,
      messageRefs: ["provider-message-123"],
    }));
    claimA2AContinuationMock.mockResolvedValueOnce(continuation());
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(sendResponse.mock.calls[0][0].text).not.toContain(
      "agent-native:persisted-artifacts",
    );
    const persisted = JSON.parse(updateThreadDataMock.mock.calls[0][1]);
    expect(persisted.messages.at(-1).metadata).toMatchObject({
      integrationDelivery: {
        platform: "slack",
        status: "delivered",
        messageRefs: ["provider-message-123"],
      },
      integrationArtifacts: [
        {
          resourceType: "document",
          id: "request_123",
          sourceAction: "call-agent",
          titleAtAction: "Launch request",
        },
      ],
    });
  });

  it("keeps provider-confirmed history retryable without redelivering", async () => {
    getThreadMappingMock.mockResolvedValue({
      internalThreadId: "thread-123",
    });
    getThreadMock.mockResolvedValue({
      id: "thread-123",
      title: "Slack thread",
      preview: "Create the request",
      threadData: JSON.stringify({ messages: [] }),
    });
    updateThreadDataMock.mockRejectedValue(new Error("database unavailable"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    claimA2AContinuationMock.mockResolvedValueOnce(
      continuation({
        status: "processing",
        terminalDeliveryKind: "success",
        terminalDeliveryConfirmedAt: Date.now(),
        terminalHistoryPayload: {
          text: "Created /page/content-1",
          deliveredAt: new Date().toISOString(),
          messageRefs: ["slack-message-1"],
          artifacts: [],
        },
      }),
    );
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(sendResponse).not.toHaveBeenCalled();
    expect(getTaskMock).not.toHaveBeenCalled();
    expect(updateThreadDataMock).toHaveBeenCalledTimes(3);
    expect(rescheduleA2AContinuationMock).toHaveBeenCalledWith(
      "cont-1",
      20_000,
    );
    expect(completeA2AContinuationMock).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("history remains retryable"),
      "Error",
    );
  });

  it.each(["mapping", "thread"] as const)(
    "retains receipt custody while the integration %s is unavailable",
    async (missing) => {
      if (missing === "mapping") {
        getThreadMappingMock.mockResolvedValue(null);
      } else {
        getThreadMock.mockResolvedValue(null);
      }
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      claimA2AContinuationMock.mockResolvedValueOnce(
        continuation({
          status: "processing",
          terminalDeliveryKind: "success",
          terminalDeliveryConfirmedAt: Date.now(),
          terminalHistoryPayload: {
            text: "Created /page/content-1",
            deliveredAt: new Date().toISOString(),
            messageRefs: ["slack-message-1"],
            artifacts: [],
          },
        }),
      );
      const { processA2AContinuationById } =
        await import("./a2a-continuation-processor.js");

      await processA2AContinuationById("cont-1", { adapters: new Map() });

      expect(completeA2AContinuationMock).not.toHaveBeenCalled();
      expect(
        completeIntegrationCampaignTaskAfterA2AMock,
      ).not.toHaveBeenCalled();
      expect(rescheduleA2AContinuationMock).toHaveBeenCalledWith(
        "cont-1",
        20_000,
      );
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining("history remains retryable"),
        "Error",
      );
    },
  );

  it("recovers provider-confirmed history in a fresh invocation without polling or sending again", async () => {
    const history = {
      text: "Created /page/content-1",
      deliveredAt: new Date().toISOString(),
      messageRefs: ["slack-message-1"],
      artifacts: [
        {
          id: "content-1",
          resourceType: "document",
          sourceAction: "call-agent",
        },
      ],
    };
    claimA2AContinuationMock.mockResolvedValueOnce(
      continuation({
        status: "processing",
        terminalDeliveryKind: "success",
        terminalDeliveryConfirmedAt: Date.now(),
        terminalHistoryPayload: history,
      }),
    );
    getIntegrationCampaignForTaskMock.mockResolvedValue({
      id: "campaign-1",
      integrationTaskId: "task-1",
      status: "waiting",
    });
    durableDispatchEnabledMock.mockReturnValue(false);
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", { adapters: new Map() });

    expect(getTaskMock).not.toHaveBeenCalled();
    expect(durableDispatchEnabledMock).not.toHaveBeenCalled();
    expect(failDisabledIntegrationCampaignTaskMock).not.toHaveBeenCalled();
    expect(completeA2AContinuationMock).toHaveBeenCalledWith("cont-1");
    expect(completeIntegrationCampaignTaskAfterA2AMock).toHaveBeenCalledWith(
      "task-1",
    );
  });

  it("uses a stable assistant message id when a committed history write is retried", async () => {
    const history = {
      text: "Created /page/content-1",
      deliveredAt: new Date().toISOString(),
      messageRefs: ["slack-message-1"],
      artifacts: [
        {
          id: "content-1",
          resourceType: "document",
          sourceAction: "call-agent",
        },
      ],
    };
    const existingMessage = {
      id: "msg-cont-1-assistant-continuation",
      role: "assistant",
      content: [{ type: "text", text: history.text }],
    };
    claimA2AContinuationMock.mockResolvedValueOnce(
      continuation({
        status: "processing",
        terminalDeliveryKind: "success",
        terminalDeliveryConfirmedAt: Date.now(),
        terminalHistoryPayload: history,
      }),
    );
    getThreadMappingMock.mockResolvedValue({ internalThreadId: "thread-123" });
    getThreadMock.mockResolvedValue({
      id: "thread-123",
      title: "Slack thread",
      preview: "Create the request",
      threadData: JSON.stringify({ messages: [existingMessage] }),
    });
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", { adapters: new Map() });

    const persisted = JSON.parse(updateThreadDataMock.mock.calls[0][1]);
    expect(persisted.messages).toHaveLength(1);
    expect(persisted.messages[0].id).toBe("msg-cont-1-assistant-continuation");
    expect(getTaskMock).not.toHaveBeenCalled();
  });

  it("recovers a provider-confirmed failure notice through the same history-only path", async () => {
    claimA2AContinuationMock.mockResolvedValueOnce(
      continuation({
        status: "processing",
        terminalDeliveryKind: "failure",
        terminalDeliveryConfirmedAt: Date.now(),
        terminalHistoryPayload: {
          text: "The Content agent could not finish this request.",
          deliveredAt: new Date().toISOString(),
          messageRefs: ["slack-message-failure"],
          artifacts: [],
        },
      }),
    );
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", { adapters: new Map() });

    expect(getTaskMock).not.toHaveBeenCalled();
    expect(completeA2AContinuationMock).toHaveBeenCalledWith("cont-1");
  });

  it("finishes the resumed native progress stream when the remote task completes", async () => {
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    const onEvent = vi.fn(async () => ({ status: "delivered" as const }));
    const complete = vi.fn(async () => ({ status: "delivered" as const }));
    const resumeRunProgress = vi.fn(async () => ({
      ref: { kind: "slack-stream", streamTs: "1719000000.000001" },
      onEvent,
      complete,
    }));
    const resumedAdapter = adapter(sendResponse);
    resumedAdapter.resumeRunProgress = resumeRunProgress;
    claimA2AContinuationMock.mockResolvedValueOnce(
      continuation({
        progressRef: {
          kind: "slack-stream",
          streamTs: "1719000000.000001",
        },
      }),
    );
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", resumedAdapter]]),
    });

    expect(resumeRunProgress).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "slack" }),
      { kind: "slack-stream", streamTs: "1719000000.000001" },
    );
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent_call", status: "done" }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "https://slides.agent-native.test/deck/deck-qa",
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(sendResponse).not.toHaveBeenCalled();
    expect(completeA2AContinuationMock).toHaveBeenCalledWith("cont-1");
  });

  it("delivers a verified Content continuation exactly once through the resumed Slack stream", async () => {
    const downstream = appendA2AArtifactLinks(
      "Created the Design Ask.",
      [
        {
          tool: "submit-content-database-form",
          result: JSON.stringify({
            createdDocumentId: "design_ask_123",
            createdDocumentTitle: "Slack correction QA",
            urlPath: "/page/design_ask_123",
            verification: { found: true },
          }),
        },
      ],
      {
        baseUrl: "https://content.agent-native.com",
        includePersistedArtifactMarker: true,
      },
    );
    getTaskMock.mockResolvedValueOnce({
      id: "a2a-task-1",
      status: {
        state: "completed",
        message: {
          role: "agent",
          parts: [{ type: "text", text: downstream }],
        },
        timestamp: new Date().toISOString(),
      },
    });
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    const onEvent = vi.fn(async () => ({ status: "delivered" as const }));
    const complete = vi.fn(async () => ({ status: "delivered" as const }));
    const resumeRunProgress = vi.fn(async () => ({
      ref: { kind: "slack-stream", streamTs: "1719000000.000001" },
      onEvent,
      complete,
    }));
    const resumedAdapter = adapter(sendResponse);
    resumedAdapter.resumeRunProgress = resumeRunProgress;
    claimA2AContinuationMock.mockResolvedValueOnce(
      continuation({
        agentName: "Content",
        agentUrl: "https://content.agent-native.com",
        progressRef: {
          kind: "slack-stream",
          streamTs: "1719000000.000001",
        },
      }),
    );
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", resumedAdapter]]),
    });

    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(
          "https://content.agent-native.com/page/design_ask_123",
        ),
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(sendResponse).not.toHaveBeenCalled();
    expect(claimA2AContinuationDeliveryMock).toHaveBeenCalledTimes(1);
    expect(completeA2AContinuationMock).toHaveBeenCalledTimes(1);
    expect(completeA2AContinuationMock).toHaveBeenCalledWith("cont-1");
    expect(rescheduleA2AContinuationMock).not.toHaveBeenCalled();
    expect(failA2AContinuationMock).not.toHaveBeenCalled();
  });

  it("falls back through the stable stream target when finalizing a resumed Slack stream fails", async () => {
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    const complete = vi.fn(async () => {
      throw new Error("chat.stopStream rejected");
    });
    const fail = vi.fn(async () => ({ status: "delivered" as const }));
    const resumedAdapter = adapter(sendResponse);
    resumedAdapter.resumeRunProgress = vi.fn(async () => ({
      ref: { kind: "slack-stream", streamTs: "1719000000.000001" },
      responseTargetRef: "1719000000.000001",
      onEvent: vi.fn(async () => ({ status: "delivered" as const })),
      complete,
      fail,
    }));
    claimA2AContinuationMock.mockResolvedValueOnce(
      continuation({
        progressRef: {
          kind: "slack-stream",
          streamTs: "1719000000.000001",
        },
      }),
    );
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", resumedAdapter]]),
    });

    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "https://slides.agent-native.test/deck/deck-qa",
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fail).toHaveBeenCalledWith(
      "I couldn't update the live response, but I posted the final result in this thread.",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "https://slides.agent-native.test/deck/deck-qa",
      }),
      expect.objectContaining({ platform: "slack" }),
      expect.objectContaining({
        idempotencyKey: "a2a-continuation:cont-1",
        reconcileAfter: expect.any(Number),
        placeholderRef: "1719000000.000001",
        strictTargetRef: true,
      }),
    );
    expect(rescheduleA2AContinuationMock).not.toHaveBeenCalled();
    expect(completeA2AContinuationMock).toHaveBeenCalledWith("cont-1");
  });

  it("falls back to a thread reply when updating a resumed Slack stream fails", async () => {
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    const onEvent = vi.fn(async (event: { type: string }) => {
      if (event.type === "agent_call") {
        throw new Error("chat.updateStream rejected");
      }
    });
    const fail = vi.fn(async () => ({ status: "delivered" as const }));
    const resumedAdapter = adapter(sendResponse);
    resumedAdapter.resumeRunProgress = vi.fn(async () => ({
      ref: { kind: "slack-stream", streamTs: "1719000000.000001" },
      onEvent,
      complete: vi.fn(async () => ({ status: "delivered" as const })),
      fail,
    }));
    claimA2AContinuationMock.mockResolvedValueOnce(
      continuation({
        progressRef: {
          kind: "slack-stream",
          streamTs: "1719000000.000001",
        },
      }),
    );
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", resumedAdapter]]),
    });

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "https://slides.agent-native.test/deck/deck-qa",
      }),
      expect.any(Object),
      expect.objectContaining({ placeholderRef: undefined }),
    );
    expect(fail).toHaveBeenCalled();
    expect(completeA2AContinuationMock).toHaveBeenCalledWith("cont-1");
  });

  it("still updates the stable target when closing a failed resumed stream also fails", async () => {
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    const complete = vi.fn(async () => {
      throw new Error("chat.stopStream rejected");
    });
    const fail = vi.fn(async () => {
      throw new Error("chat.stopStream rejected again");
    });
    const resumedAdapter = adapter(sendResponse);
    resumedAdapter.resumeRunProgress = vi.fn(async () => ({
      ref: { kind: "slack-stream", streamTs: "1719000000.000001" },
      responseTargetRef: "1719000000.000001",
      onEvent: vi.fn(async () => ({ status: "delivered" as const })),
      complete,
      fail,
    }));
    claimA2AContinuationMock.mockResolvedValueOnce(
      continuation({
        progressRef: {
          kind: "slack-stream",
          streamTs: "1719000000.000001",
        },
      }),
    );
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", resumedAdapter]]),
    });

    expect(fail).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "https://slides.agent-native.test/deck/deck-qa",
      }),
      expect.objectContaining({ platform: "slack" }),
      expect.objectContaining({
        idempotencyKey: "a2a-continuation:cont-1",
        reconcileAfter: expect.any(Number),
        placeholderRef: "1719000000.000001",
        strictTargetRef: true,
      }),
    );
    expect(completeA2AContinuationMock).toHaveBeenCalledWith("cont-1");
  });

  it("expands relative URLs against the agent public base, not the A2A endpoint", async () => {
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    claimA2AContinuationMock.mockResolvedValueOnce(
      continuation({
        agentName: "Analytics",
        agentUrl:
          "https://agent-workspace.builder.io/analytics/_agent-native/a2a",
      }),
    );
    getTaskMock.mockResolvedValueOnce({
      id: "a2a-task-1",
      status: {
        state: "completed",
        message: {
          role: "agent",
          parts: [{ type: "text", text: "Report: /analyses/qa-report" }],
        },
        timestamp: new Date().toISOString(),
      },
    });
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Report: https://agent-workspace.builder.io/analytics/analyses/qa-report",
      }),
      expect.any(Object),
      expect.objectContaining({ placeholderRef: undefined }),
    );
    expect(completeA2AContinuationMock).toHaveBeenCalledWith("cont-1");
  });

  it("blocks unverified completed production artifact URLs before posting continuations", async () => {
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    claimA2AContinuationMock.mockResolvedValueOnce(continuation());
    getTaskMock.mockResolvedValueOnce({
      id: "a2a-task-1",
      status: {
        state: "completed",
        message: {
          role: "agent",
          parts: [
            {
              type: "text",
              text: "The Design agent returned https://design.agent-native.com/design/design_fake",
            },
          ],
        },
        timestamp: new Date().toISOString(),
      },
    });
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("could not verify the design URL"),
      }),
      expect.any(Object),
      expect.objectContaining({ placeholderRef: undefined }),
    );
    expect(sendResponse.mock.calls[0][0].text).not.toContain("design_fake");
    expect(completeA2AContinuationMock).toHaveBeenCalledWith("cont-1");
  });

  it("allows completed continuation artifact URLs with downstream proof blocks", async () => {
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    claimA2AContinuationMock.mockResolvedValueOnce(continuation());
    getTaskMock.mockResolvedValueOnce({
      id: "a2a-task-1",
      status: {
        state: "completed",
        message: {
          role: "agent",
          parts: [
            {
              type: "text",
              text: [
                "Design ready: https://design.agent-native.com/design/design_real",
                "",
                "Artifacts:",
                "- Design: https://design.agent-native.com/design/design_real (ID: design_real, 1 file)",
              ].join("\n"),
            },
          ],
        },
        timestamp: new Date().toISOString(),
      },
    });
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(
          "https://design.agent-native.com/design/design_real",
        ),
      }),
      expect.any(Object),
      expect.objectContaining({ placeholderRef: undefined }),
    );
    expect(sendResponse.mock.calls[0][0].text).not.toContain(
      "could not verify",
    );
    expect(completeA2AContinuationMock).toHaveBeenCalledWith("cont-1");
  });

  it("reschedules history finalization failures without redelivering", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    claimA2AContinuationMock.mockResolvedValueOnce(continuation());
    completeA2AContinuationMock
      .mockRejectedValueOnce(new Error("db unavailable"))
      .mockRejectedValueOnce(new Error("db unavailable"))
      .mockRejectedValueOnce(new Error("db unavailable"));
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(sendResponse).toHaveBeenCalledTimes(1);
    expect(completeA2AContinuationMock).toHaveBeenCalledTimes(3);
    expect(rescheduleA2AContinuationMock).toHaveBeenCalledWith(
      "cont-1",
      20_000,
    );
    expect(failA2AContinuationMock).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("history remains retryable"),
      "Error",
    );
  });

  it("wakes receipt-backed parent recovery after finalizing history", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    claimA2AContinuationMock.mockResolvedValueOnce(continuation());
    getIntegrationCampaignForTaskMock.mockResolvedValue({
      id: "campaign-1",
      integrationTaskId: "task-1",
      status: "waiting",
    });
    completeIntegrationCampaignTaskAfterA2AMock
      .mockRejectedValueOnce(new Error("db unavailable"))
      .mockRejectedValueOnce(new Error("db unavailable"))
      .mockRejectedValueOnce(new Error("db unavailable"));
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(sendResponse).toHaveBeenCalledTimes(1);
    expect(completeIntegrationCampaignTaskAfterA2AMock).toHaveBeenCalledTimes(
      3,
    );
    expect(completeA2AContinuationMock).toHaveBeenCalledOnce();
    expect(rescheduleA2AContinuationMock).not.toHaveBeenCalled();
    expect(dispatchPendingIntegrationTaskMock).toHaveBeenCalledWith({
      taskId: "task-1",
      task: {
        platform: "slack",
        externalThreadId: "C123:123.456",
        platformContext: { channelId: "C123", threadTs: "123.456" },
      },
      campaignContinuation: true,
      allowPortableConfirmedReceiptReconciliation: true,
    });
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("parent completion remains retryable"),
      "Error",
    );
  });

  it("does not post completed text when another processor already claimed delivery", async () => {
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    claimA2AContinuationMock.mockResolvedValueOnce(continuation());
    claimA2AContinuationDeliveryMock.mockResolvedValueOnce(null);
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(claimA2AContinuationDeliveryMock).toHaveBeenCalledWith("cont-1");
    expect(sendResponse).not.toHaveBeenCalled();
    expect(completeA2AContinuationMock).not.toHaveBeenCalled();
    expect(rescheduleA2AContinuationMock).not.toHaveBeenCalled();
    expect(failA2AContinuationMock).not.toHaveBeenCalled();
  });

  it("does not bypass the store claim for an in-flight delivery", async () => {
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    getA2AContinuationMock.mockResolvedValueOnce(
      continuation({
        status: "delivering",
        updatedAt: Date.now(),
      }),
    );
    claimA2AContinuationMock.mockResolvedValueOnce(null);
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(claimA2AContinuationMock).toHaveBeenCalledWith("cont-1");
    expect(getTaskMock).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
    expect(completeA2AContinuationMock).not.toHaveBeenCalled();
    expect(rescheduleA2AContinuationMock).not.toHaveBeenCalled();
    expect(failA2AContinuationMock).not.toHaveBeenCalled();
  });

  it("reuses opaque bearer tokens stored on the continuation", async () => {
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    claimA2AContinuationMock.mockResolvedValueOnce(
      continuation({ a2aAuthToken: "original-opaque-a2a-token" }),
    );
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(A2AClientMock).toHaveBeenCalledWith(
      "https://slides.agent-native.test",
      "original-opaque-a2a-token",
      { requestTimeoutMs: 8_000 },
    );
    expect(signA2ATokenMock).not.toHaveBeenCalled();
    expect(completeA2AContinuationMock).toHaveBeenCalledWith("cont-1");
  });

  it("re-signs instead of replaying a stored A2A JWT", async () => {
    process.env.A2A_SECRET = "shared-a2a-secret";
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    claimA2AContinuationMock.mockResolvedValueOnce(
      continuation({ a2aAuthToken: "old.jwt.token" }),
    );
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(signA2ATokenMock).toHaveBeenCalledWith(
      "alice+qa@agent-native.test",
      undefined,
      undefined,
      { expiresIn: "30m", preferGlobalSecret: true },
    );
    expect(A2AClientMock).toHaveBeenCalledWith(
      "https://slides.agent-native.test",
      "signed-a2a-token",
      { requestTimeoutMs: 8_000 },
    );
    expect(completeA2AContinuationMock).toHaveBeenCalledWith("cont-1");
  });

  it("prefers the shared A2A secret for continuation polling when available", async () => {
    process.env.A2A_SECRET = "workspace-global-a2a-secret";
    signA2ATokenMock
      .mockResolvedValueOnce("shared-signed-a2a-token")
      .mockResolvedValueOnce("org-signed-a2a-token");
    vi.doMock("../org/context.js", () => ({
      getOrgDomain: vi.fn(async () => "builder.io"),
      getOrgA2ASecret: vi.fn(async () => "builder-org-a2a-secret"),
    }));
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    claimA2AContinuationMock.mockResolvedValueOnce(
      continuation({ orgId: "builder_io" }),
    );
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(signA2ATokenMock).toHaveBeenNthCalledWith(
      1,
      "alice+qa@agent-native.test",
      "builder.io",
      "builder-org-a2a-secret",
      { expiresIn: "30m", preferGlobalSecret: true },
    );
    expect(signA2ATokenMock).toHaveBeenNthCalledWith(
      2,
      "alice+qa@agent-native.test",
      "builder.io",
      "builder-org-a2a-secret",
      { expiresIn: "30m", preferGlobalSecret: false },
    );
    expect(A2AClientMock).toHaveBeenCalledWith(
      "https://slides.agent-native.test",
      "shared-signed-a2a-token",
      { requestTimeoutMs: 8_000, fallbackApiKeys: ["org-signed-a2a-token"] },
    );
    expect(completeA2AContinuationMock).toHaveBeenCalledWith("cont-1");
    vi.doUnmock("../org/context.js");
  });

  it("preserves an originally unsigned A2A call when polling a continuation", async () => {
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    claimA2AContinuationMock.mockResolvedValueOnce(
      continuation({ a2aAuthToken: "" }),
    );
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(A2AClientMock).toHaveBeenCalledWith(
      "https://slides.agent-native.test",
      undefined,
      { requestTimeoutMs: 8_000 },
    );
    expect(signA2ATokenMock).not.toHaveBeenCalled();
    expect(completeA2AContinuationMock).toHaveBeenCalledWith("cont-1");
  });

  it("notifies the platform when the remote task fails", async () => {
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    claimA2AContinuationMock.mockResolvedValueOnce(continuation());
    getTaskMock.mockResolvedValueOnce({
      id: "a2a-task-1",
      status: {
        state: "failed",
        message: {
          role: "agent",
          parts: [{ type: "text", text: "The deck export failed" }],
        },
        timestamp: new Date().toISOString(),
      },
    });
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(
          "The Slides agent could not finish this request: The deck export failed",
        ),
      }),
      expect.any(Object),
      expect.objectContaining({ placeholderRef: undefined }),
    );
    expect(recordA2ATerminalDeliveryReceiptMock).toHaveBeenCalledWith(
      "cont-1",
      "failure",
      expect.any(Object),
      "The deck export failed",
    );
    expect(completeA2AContinuationMock).toHaveBeenCalledWith("cont-1");
  });

  it("retains the failure delivery claim when its receipt cannot be recorded", async () => {
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    claimA2AContinuationMock.mockResolvedValueOnce(continuation());
    getTaskMock.mockResolvedValueOnce({
      id: "a2a-task-1",
      status: {
        state: "failed",
        message: {
          role: "agent",
          parts: [{ type: "text", text: "The deck export failed" }],
        },
        timestamp: new Date().toISOString(),
      },
    });
    recordA2ATerminalDeliveryReceiptMock.mockRejectedValue(
      new Error("receipt database unavailable"),
    );
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(sendResponse).toHaveBeenCalledOnce();
    expect(recordA2ATerminalDeliveryReceiptMock).toHaveBeenCalledTimes(3);
    expect(retainA2AUnconfirmedDeliveryClaimMock).toHaveBeenCalledWith(
      "cont-1",
    );
    expect(rescheduleA2AContinuationMock).not.toHaveBeenCalled();
    expect(completeA2AContinuationMock).not.toHaveBeenCalled();
  });

  it("retries a terminal failure notification until delivery is confirmed", async () => {
    const sendResponse = vi.fn(async () => {
      throw new Error("Slack delivery unavailable");
    });
    claimA2AContinuationMock.mockResolvedValueOnce(continuation());
    getTaskMock.mockResolvedValueOnce({
      id: "a2a-task-1",
      status: {
        state: "failed",
        message: {
          role: "agent",
          parts: [{ type: "text", text: "The deck export failed" }],
        },
        timestamp: new Date().toISOString(),
      },
    });
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(rescheduleA2AContinuationMock).toHaveBeenCalledWith(
      "cont-1",
      20_000,
    );
    expect(dispatchPendingIntegrationTaskMock).not.toHaveBeenCalled();
    expect(failA2AContinuationMock).not.toHaveBeenCalled();
    expect(completeIntegrationCampaignTaskAfterA2AMock).not.toHaveBeenCalled();
  });

  it("retains parent custody when failure notification delivery exhausts its bound", async () => {
    const exhausted = continuation({ attempts: 30 });
    const sendResponse = vi.fn(async () => {
      throw new Error("Slack delivery unavailable");
    });
    claimA2AContinuationMock.mockResolvedValueOnce(exhausted);
    claimA2AContinuationDeliveryMock.mockResolvedValueOnce({
      ...exhausted,
      status: "delivering",
    });
    getIntegrationCampaignForTaskMock.mockResolvedValue({
      id: "campaign-1",
      integrationTaskId: exhausted.integrationTaskId,
      status: "waiting",
    });
    getTaskMock.mockResolvedValueOnce({
      id: exhausted.a2aTaskId,
      status: {
        state: "failed",
        message: {
          role: "agent",
          parts: [{ type: "text", text: "The deck export failed" }],
        },
        timestamp: new Date().toISOString(),
      },
    });
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById(exhausted.id, {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(rescheduleA2AContinuationMock).toHaveBeenCalledWith(
      exhausted.id,
      20_000,
    );
    expect(failA2AContinuationMock).not.toHaveBeenCalled();
    expect(completeIntegrationCampaignTaskAfterA2AMock).not.toHaveBeenCalled();
  });

  it("rechecks durable scope before claiming a terminal failure notification", async () => {
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    const claimed = continuation();
    claimA2AContinuationMock.mockResolvedValueOnce(claimed);
    getIntegrationCampaignForTaskMock.mockResolvedValue({
      id: "campaign-1",
      integrationTaskId: claimed.integrationTaskId,
      status: "processing",
    });
    durableDispatchEnabledMock
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    getTaskMock.mockResolvedValueOnce({
      id: claimed.a2aTaskId,
      status: {
        state: "failed",
        message: {
          role: "agent",
          parts: [{ type: "text", text: "The deck export failed" }],
        },
        timestamp: new Date().toISOString(),
      },
    });
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById(claimed.id, {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(claimA2AContinuationDeliveryMock).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
    expect(failDisabledIntegrationCampaignTaskMock).toHaveBeenCalledWith(
      claimed.integrationTaskId,
      expect.stringContaining("disabled"),
    );
  });

  it("includes a safe downstream error code and request ID in failure replies", async () => {
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    claimA2AContinuationMock.mockResolvedValueOnce(
      continuation({
        id: "cont-slack-lookup-456",
        integrationTaskId: "task-slack-lookup-123",
        a2aTaskId: "a2a-slack-lookup-789",
      }),
    );
    claimA2AContinuationDeliveryMock.mockResolvedValueOnce(
      continuation({
        id: "cont-slack-lookup-456",
        integrationTaskId: "task-slack-lookup-123",
        a2aTaskId: "a2a-slack-lookup-789",
      }),
    );
    getTaskMock.mockResolvedValueOnce({
      id: "a2a-task-1",
      status: {
        state: "failed",
        message: {
          role: "agent",
          parts: [
            {
              type: "text",
              text: "I ran out of time before finishing this step. code: run_budget_exhausted",
            },
          ],
        },
        timestamp: new Date().toISOString(),
      },
    });
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    const sentText = vi.mocked(sendResponse).mock.calls[0]?.[0].text ?? "";
    expect(sentText).toContain("Error code: `run_budget_exhausted`");
    expect(sentText).toContain("Request ID: `task-slack-lookup-123`");
    expect(sentText).toContain("Continuation ID: `cont-slack-lookup-456`");
    expect(sentText).toContain("Downstream task ID: `a2a-slack-lookup-789`");
  });

  it("normalizes explicit code= markers before including them in failure replies", async () => {
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    claimA2AContinuationMock.mockResolvedValueOnce(continuation());
    getTaskMock.mockResolvedValueOnce({
      id: "a2a-task-1",
      status: {
        state: "failed",
        message: {
          role: "agent",
          parts: [
            {
              type: "text",
              text: "Analysis failed. code=UPSTREAM_UNAVAILABLE",
            },
          ],
        },
        timestamp: new Date().toISOString(),
      },
    });
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    const sentText = vi.mocked(sendResponse).mock.calls[0]?.[0].text ?? "";
    expect(sentText).toContain("Error code: `upstream_unavailable`");
  });

  it("describes downstream LLM credential failures without naming a raw env var", async () => {
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    claimA2AContinuationMock.mockResolvedValueOnce(continuation());
    getTaskMock.mockResolvedValueOnce({
      id: "a2a-task-1",
      status: {
        state: "failed",
        message: {
          role: "agent",
          parts: [{ type: "text", text: "ANTHROPIC_API_KEY is not set" }],
        },
        timestamp: new Date().toISOString(),
      },
    });
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    const sentText = vi.mocked(sendResponse).mock.calls[0]?.[0].text ?? "";
    expect(sentText).toContain("needs an LLM connection");
    expect(sentText).toContain("Manage agent > LLM");
    expect(sentText).not.toContain("ANTHROPIC_API_KEY");
    expect(sentText).toContain("Error code: `missing_credentials`");
    expect(sentText).toContain("Request ID: `task-1`");
    expect(recordA2ATerminalDeliveryReceiptMock).toHaveBeenCalledWith(
      "cont-1",
      "failure",
      expect.any(Object),
      "ANTHROPIC_API_KEY is not set",
    );
  });

  it("backs off a still-working remote task and redispatches itself", async () => {
    vi.useFakeTimers();
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    claimA2AContinuationMock.mockResolvedValueOnce(continuation());
    getTaskMock.mockResolvedValue({
      id: "a2a-task-1",
      status: {
        state: "working",
        timestamp: new Date().toISOString(),
      },
    });
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    const processing = processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });
    await vi.advanceTimersByTimeAsync(20_000);
    await processing;

    expect(sendResponse).not.toHaveBeenCalled();
    expect(failA2AContinuationMock).not.toHaveBeenCalled();
    expect(rescheduleA2AContinuationMock).toHaveBeenCalledWith(
      "cont-1",
      20_000,
    );
    expect(fetch).toHaveBeenCalled();
  });

  it("notifies the platform when a still-working remote task exhausts polling attempts", async () => {
    vi.useFakeTimers();
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    claimA2AContinuationMock.mockResolvedValueOnce(
      continuation({ attempts: 30 }),
    );
    getTaskMock.mockResolvedValue({
      id: "a2a-task-1",
      status: {
        state: "working",
        timestamp: new Date().toISOString(),
      },
    });
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    const processing = processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await processing;

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(
          "The Slides agent could not finish this request: Timed out polling the Slides A2A task a2a-task-1 after 30 attempts",
        ),
      }),
      expect.any(Object),
      expect.objectContaining({ placeholderRef: undefined }),
    );
    expect(recordA2ATerminalDeliveryReceiptMock).toHaveBeenCalledWith(
      "cont-1",
      "failure",
      expect.any(Object),
      expect.stringContaining(
        "Timed out polling the Slides A2A task a2a-task-1 after 30 attempts",
      ),
    );
    expect(rescheduleA2AContinuationMock).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps polling when a still-working remote task reports recoverable artifacts", async () => {
    vi.useFakeTimers();
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    const onEvent = vi.fn(async () => ({ status: "delivered" as const }));
    const resumedAdapter = adapter(sendResponse);
    resumedAdapter.resumeRunProgress = vi.fn(async () => ({
      ref: { kind: "slack-stream", streamTs: "1719000000.000001" },
      onEvent,
      complete: vi.fn(async () => ({ status: "delivered" as const })),
    }));
    claimA2AContinuationMock.mockResolvedValueOnce(
      continuation({
        progressRef: {
          kind: "slack-stream",
          streamTs: "1719000000.000001",
        },
      }),
    );
    getTaskMock.mockResolvedValue({
      id: "a2a-task-1",
      status: {
        state: "working",
        message: {
          role: "agent",
          metadata: { agentNativeRecoverableArtifacts: true },
          parts: [
            {
              type: "text",
              text: "Artifacts:\n- Deck: /deck/deck-qa (ID: deck-qa)",
            },
          ],
        },
        timestamp: new Date().toISOString(),
      },
    });
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    const processing = processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", resumedAdapter]]),
    });
    await vi.advanceTimersByTimeAsync(20_000);
    await processing;

    expect(sendResponse).not.toHaveBeenCalled();
    expect(completeA2AContinuationMock).not.toHaveBeenCalled();
    expect(rescheduleA2AContinuationMock).toHaveBeenCalledWith(
      "cont-1",
      20_000,
    );
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent_call_progress",
        agent: "Slides",
      }),
    );
    expect(failA2AContinuationMock).not.toHaveBeenCalled();
  });

  it("keeps polling past checkpoint A so a later final artifact B wins", async () => {
    vi.useFakeTimers();
    process.env.A2A_SECRET = "test-a2a-secret-for-signed-checkpoints";
    const checkpointAToolResults = [
      {
        tool: "submit-content-database-form",
        result: JSON.stringify({
          createdDocumentId: "request_checkpoint_a",
          urlPath: "/page/request_checkpoint_a",
          verification: { found: true },
        }),
      },
    ];
    const checkpointAMessage = buildA2ARecoverableArtifactMessage(
      checkpointAToolResults,
    );
    const checkpointA = appendA2AArtifactLinks(
      checkpointAMessage!,
      checkpointAToolResults,
      { includePersistedArtifactMarker: true },
    );
    const finalBToolResults = [
      {
        tool: "submit-content-database-form",
        result: JSON.stringify({
          createdDocumentId: "request_final_b",
          urlPath: "/page/request_final_b",
          verification: { found: true },
        }),
      },
    ];
    const finalB = appendA2AArtifactLinks(
      "Final artifact B",
      finalBToolResults,
      {
        includePersistedArtifactMarker: true,
      },
    );
    getTaskMock
      .mockResolvedValueOnce({
        id: "a2a-task-1",
        status: {
          state: "working",
          message: {
            role: "agent",
            metadata: { agentNativeRecoverableArtifacts: true },
            parts: [{ type: "text", text: checkpointA }],
          },
          timestamp: new Date().toISOString(),
        },
      })
      .mockResolvedValueOnce({
        id: "a2a-task-1",
        status: {
          state: "completed",
          message: {
            role: "agent",
            parts: [{ type: "text", text: finalB }],
          },
          timestamp: new Date().toISOString(),
        },
      });
    claimA2AContinuationMock.mockResolvedValueOnce(continuation());
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    const processing = processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });
    await vi.advanceTimersByTimeAsync(2_000);
    await processing;

    expect(getTaskMock).toHaveBeenCalledTimes(2);
    expect(saveA2AVerifiedArtifactCheckpointMock).toHaveBeenCalledWith(
      "cont-1",
      expect.stringContaining("request_checkpoint_a"),
    );
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("request_final_b"),
      }),
      expect.any(Object),
      expect.objectContaining({ placeholderRef: undefined }),
    );
    expect(sendResponse.mock.calls[0][0].text).not.toContain(
      "request_checkpoint_a",
    );
    expect(completeA2AContinuationMock).toHaveBeenCalledWith("cont-1");
    expect(rescheduleA2AContinuationMock).not.toHaveBeenCalled();
  });

  it("delivers a verified artifact checkpoint recovered by a fresh processor invocation", async () => {
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    const persistedCheckpoint =
      "The agent is still working on the full response, but these verified artifacts already exist:\n- Content: /page/content-1";
    claimA2AContinuationMock.mockResolvedValueOnce(
      continuation({
        attempts: 30,
        verifiedArtifactCheckpoint: persistedCheckpoint,
      }),
    );
    claimA2AContinuationDeliveryMock.mockResolvedValueOnce(
      continuation({ status: "delivering" }),
    );
    getTaskMock.mockResolvedValueOnce({
      id: "a2a-task-1",
      status: {
        state: "failed",
        message: {
          role: "agent",
          parts: [{ type: "text", text: "remote worker exited" }],
        },
        timestamp: new Date().toISOString(),
      },
    });
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("/page/content-1"),
      }),
      expect.any(Object),
      expect.objectContaining({ placeholderRef: undefined }),
    );
    expect(completeA2AContinuationMock).toHaveBeenCalledWith("cont-1");
    expect(failA2AContinuationMock).not.toHaveBeenCalled();
  });

  it("delivers a durable checkpoint instead of a failure notice after an exhausted non-transient poll error", async () => {
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    claimA2AContinuationMock.mockResolvedValueOnce(
      continuation({
        attempts: 30,
        verifiedArtifactCheckpoint: "Verified Content: /page/content-1",
      }),
    );
    claimA2AContinuationDeliveryMock.mockResolvedValueOnce(
      continuation({ status: "delivering", attempts: 30 }),
    );
    getTaskMock.mockRejectedValueOnce(new Error("unexpected response shape"));
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("/page/content-1"),
      }),
      expect.any(Object),
      expect.objectContaining({ placeholderRef: undefined }),
    );
    expect(completeA2AContinuationMock).toHaveBeenCalledWith("cont-1");
    expect(recordA2ATerminalDeliveryReceiptMock).toHaveBeenCalledWith(
      "cont-1",
      "success",
      expect.any(Object),
      undefined,
    );
  });

  it("delivers the latest signed checkpoint only when remote polling is exhausted", async () => {
    vi.useFakeTimers();
    process.env.A2A_SECRET = "test-a2a-secret-for-signed-checkpoints";
    const toolResults = [
      {
        tool: "submit-content-database-form",
        result: JSON.stringify({
          createdDocumentId: "request_checkpoint_retry",
          urlPath: "/page/request_checkpoint_retry",
          verification: { found: true },
        }),
      },
    ];
    const checkpointMessage = buildA2ARecoverableArtifactMessage(toolResults);
    const checkpoint = appendA2AArtifactLinks(checkpointMessage!, toolResults, {
      includePersistedArtifactMarker: true,
    });
    getTaskMock.mockResolvedValue({
      id: "a2a-task-1",
      status: {
        state: "working",
        message: {
          role: "agent",
          metadata: { agentNativeRecoverableArtifacts: true },
          parts: [{ type: "text", text: checkpoint! }],
        },
        timestamp: new Date().toISOString(),
      },
    });
    claimA2AContinuationMock.mockResolvedValueOnce(
      continuation({ attempts: 30 }),
    );
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    const processing = processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await processing;

    expect(sendResponse).toHaveBeenCalledOnce();
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("request_checkpoint_retry"),
      }),
      expect.any(Object),
      expect.objectContaining({ placeholderRef: undefined }),
    );
    expect(sendResponse.mock.calls[0][0].text).toContain(
      "did not finish its full response",
    );
    expect(completeA2AContinuationMock).toHaveBeenCalledWith("cont-1");
    expect(rescheduleA2AContinuationMock).not.toHaveBeenCalled();
  });

  it("verifies recoverable checkpoints with an organization-only A2A secret", async () => {
    vi.useFakeTimers();
    delete process.env.A2A_SECRET;
    const orgSecret = "org-only-a2a-secret-for-signed-checkpoints";
    vi.doMock("../org/context.js", () => ({
      getOrgDomain: vi.fn(async () => "builder.io"),
      getOrgA2ASecret: vi.fn(async () => orgSecret),
    }));
    const toolResults = [
      {
        tool: "submit-content-database-form",
        result: JSON.stringify({
          createdDocumentId: "request_org_checkpoint",
          urlPath: "/page/request_org_checkpoint",
          verification: { found: true },
        }),
      },
    ];
    const checkpointMessage = buildA2ARecoverableArtifactMessage(toolResults);
    const checkpoint = appendA2AArtifactLinks(checkpointMessage!, toolResults, {
      includePersistedArtifactMarker: true,
      persistedArtifactSecret: orgSecret,
    });
    getTaskMock.mockResolvedValue({
      id: "a2a-task-1",
      status: {
        state: "working",
        message: {
          role: "agent",
          metadata: { agentNativeRecoverableArtifacts: true },
          parts: [{ type: "text", text: checkpoint }],
        },
        timestamp: new Date().toISOString(),
      },
    });
    claimA2AContinuationMock.mockResolvedValueOnce(
      continuation({ attempts: 30, orgId: "builder_io" }),
    );
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    const processing = processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await processing;

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("request_org_checkpoint"),
      }),
      expect.any(Object),
      expect.objectContaining({ placeholderRef: undefined }),
    );
    expect(completeA2AContinuationMock).toHaveBeenCalledWith("cont-1");
    expect(rescheduleA2AContinuationMock).not.toHaveBeenCalled();
  });

  it("treats aborted task polling as transient while attempts remain", async () => {
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    claimA2AContinuationMock.mockResolvedValueOnce(continuation());
    getTaskMock.mockRejectedValueOnce(
      new DOMException("This operation was aborted", "AbortError"),
    );
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(sendResponse).not.toHaveBeenCalled();
    expect(failA2AContinuationMock).not.toHaveBeenCalled();
    expect(rescheduleA2AContinuationMock).toHaveBeenCalledWith(
      "cont-1",
      20_000,
    );
    expect(fetch).toHaveBeenCalled();
  });

  it("notifies the platform when transient polling errors exhaust attempts", async () => {
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    claimA2AContinuationMock.mockResolvedValueOnce(
      continuation({ attempts: 30 }),
    );
    getTaskMock.mockRejectedValueOnce(
      new DOMException("This operation was aborted", "AbortError"),
    );
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(
          "The Slides agent could not finish this request: Timed out polling the Slides A2A task a2a-task-1 after 30 attempts",
        ),
      }),
      expect.any(Object),
      expect.objectContaining({ placeholderRef: undefined }),
    );
    expect(recordA2ATerminalDeliveryReceiptMock).toHaveBeenCalledWith(
      "cont-1",
      "failure",
      expect.any(Object),
      expect.stringContaining(
        "Timed out polling the Slides A2A task a2a-task-1 after 30 attempts",
      ),
    );
    expect(rescheduleA2AContinuationMock).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("treats A2A token rejection during polling as transient while attempts remain", async () => {
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    claimA2AContinuationMock.mockResolvedValueOnce(continuation());
    getTaskMock.mockRejectedValueOnce(
      new Error(
        'A2A request failed (401): {"error":{"message":"Invalid or expired A2A token"}}',
      ),
    );
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(sendResponse).not.toHaveBeenCalled();
    expect(failA2AContinuationMock).not.toHaveBeenCalled();
    expect(rescheduleA2AContinuationMock).toHaveBeenCalledWith(
      "cont-1",
      20_000,
    );
    expect(fetch).toHaveBeenCalled();
  });

  it("treats Netlify loop-protection 508s as transient while attempts remain", async () => {
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    claimA2AContinuationMock.mockResolvedValueOnce(continuation());
    getTaskMock.mockRejectedValueOnce(
      new Error("A2A request failed (508): loop detected"),
    );
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(sendResponse).not.toHaveBeenCalled();
    expect(failA2AContinuationMock).not.toHaveBeenCalled();
    expect(rescheduleA2AContinuationMock).toHaveBeenCalledWith(
      "cont-1",
      20_000,
    );
    expect(fetch).toHaveBeenCalled();
  });

  it("reports a friendly timeout when task polling aborts after the remote work deadline", async () => {
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    claimA2AContinuationMock.mockResolvedValueOnce(
      continuation({
        attempts: 99,
        createdAt: Date.now() - 20 * 60_000 - 1,
      }),
    );
    getTaskMock.mockRejectedValueOnce(
      new DOMException("This operation was aborted", "AbortError"),
    );
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    const sentText = vi.mocked(sendResponse).mock.calls[0]?.[0].text ?? "";
    expect(sentText).toContain(
      "The Slides agent could not finish this request: Timed out polling the Slides A2A task a2a-task-1 after 20 minutes",
    );
    expect(sentText).not.toContain("This operation was aborted");
    expect(recordA2ATerminalDeliveryReceiptMock).toHaveBeenCalledWith(
      "cont-1",
      "failure",
      expect.any(Object),
      expect.stringContaining(
        "Timed out polling the Slides A2A task a2a-task-1 after 20 minutes",
      ),
    );
  });

  it("waits until a redispatched continuation is due before claiming it", async () => {
    vi.useFakeTimers();
    const dueAt = Date.now() + 5_000;
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    getA2AContinuationMock.mockResolvedValueOnce(
      continuation({ status: "pending", nextCheckAt: dueAt }),
    );
    claimA2AContinuationMock.mockResolvedValueOnce(
      continuation({ status: "pending", nextCheckAt: dueAt }),
    );
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    const processing = processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    await vi.advanceTimersByTimeAsync(4_999);
    expect(claimA2AContinuationMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await processing;

    expect(claimA2AContinuationMock).toHaveBeenCalledWith("cont-1");
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "https://slides.agent-native.test/deck/deck-qa",
      }),
      expect.any(Object),
      expect.objectContaining({ placeholderRef: undefined }),
    );
  });

  it("does not claim continuations that are scheduled far in the future", async () => {
    vi.useFakeTimers();
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    getA2AContinuationMock.mockResolvedValueOnce(
      continuation({ status: "pending", nextCheckAt: Date.now() + 30_000 }),
    );
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    const processing = processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    await vi.advanceTimersByTimeAsync(9_999);
    expect(claimA2AContinuationMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await processing;

    expect(claimA2AContinuationMock).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it("notifies the platform when a remote task exceeds the continuation age limit", async () => {
    vi.useFakeTimers();
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    claimA2AContinuationMock.mockResolvedValueOnce(
      continuation({
        attempts: 20,
        createdAt: Date.now() - 20 * 60_000 - 1,
      }),
    );
    getTaskMock.mockResolvedValue({
      id: "a2a-task-1",
      status: {
        state: "working",
        timestamp: new Date().toISOString(),
      },
    });
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    const processing = processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });
    await vi.advanceTimersByTimeAsync(20_000);
    await processing;

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(
          "The Slides agent could not finish this request: Timed out polling the Slides A2A task a2a-task-1 after 20 minutes",
        ),
      }),
      expect.any(Object),
      expect.objectContaining({ placeholderRef: undefined }),
    );
    expect(recordA2ATerminalDeliveryReceiptMock).toHaveBeenCalledWith(
      "cont-1",
      "failure",
      expect.any(Object),
      expect.stringContaining(
        "Timed out polling the Slides A2A task a2a-task-1 after 20 minutes",
      ),
    );
  });

  it("reschedules and redispatches when the platform send fails", async () => {
    const sendResponse = vi.fn(async () => {
      throw new Error("slack unavailable");
    });
    claimA2AContinuationMock.mockResolvedValueOnce(continuation());
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(rescheduleA2AContinuationMock).toHaveBeenCalledWith(
      "cont-1",
      20_000,
    );
    expect(fetch).toHaveBeenCalled();
    expect(completeA2AContinuationMock).not.toHaveBeenCalled();
  });

  it("aborts and settles a hung platform send before releasing its claim", async () => {
    vi.useFakeTimers();
    let settleAbortedSend: (() => void) | undefined;
    const sendResponse = vi.fn(
      (_message: unknown, _incoming: unknown, opts?: PlatformDeliveryOptions) =>
        new Promise<void>((_resolve, reject) => {
          opts?.signal?.addEventListener(
            "abort",
            () => {
              settleAbortedSend = () => reject(opts.signal?.reason);
            },
            { once: true },
          );
        }),
    );
    claimA2AContinuationMock.mockResolvedValueOnce(continuation());
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    const processing = processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    await vi.advanceTimersByTimeAsync(12_000);
    expect(rescheduleA2AContinuationMock).not.toHaveBeenCalled();
    expect(settleAbortedSend).toBeTypeOf("function");
    settleAbortedSend?.();
    await processing;

    expect(rescheduleA2AContinuationMock).toHaveBeenCalledWith(
      "cont-1",
      20_000,
    );
    expect(fetch).toHaveBeenCalled();
    expect(completeA2AContinuationMock).not.toHaveBeenCalled();
  });
});
