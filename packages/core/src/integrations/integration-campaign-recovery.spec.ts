import { beforeEach, describe, expect, it, vi } from "vitest";

const listDueMock = vi.hoisted(() => vi.fn());
const deferRuntimeMock = vi.hoisted(() => vi.fn());
const getCampaignMock = vi.hoisted(() => vi.fn());
const getTaskMock = vi.hoisted(() => vi.fn());
const dispatchMock = vi.hoisted(() => vi.fn());
const durableEnabledMock = vi.hoisted(() => vi.fn());
const durableExplicitlyDisabledMock = vi.hoisted(() => vi.fn());
const failDisabledMock = vi.hoisted(() => vi.fn());
const getNextTaskMock = vi.hoisted(() => vi.fn());
const getA2AContinuationTaskOutcomeMock = vi.hoisted(() => vi.fn());

vi.mock("./integration-campaigns-store.js", () => ({
  listDueIntegrationCampaignIds: listDueMock,
  deferIntegrationCampaignForRuntime: deferRuntimeMock,
  getIntegrationCampaign: getCampaignMock,
  failDisabledIntegrationCampaignTask: failDisabledMock,
}));

vi.mock("./pending-tasks-store.js", () => ({
  getPendingTask: getTaskMock,
  getNextPendingTaskForThread: getNextTaskMock,
}));

vi.mock("./integration-durable-dispatch.js", () => ({
  dispatchPendingIntegrationTask: dispatchMock,
  isIntegrationDurableDispatchEnabledForTask: durableEnabledMock,
  isIntegrationDurableDispatchExplicitlyDisabledForTask:
    durableExplicitlyDisabledMock,
}));

vi.mock("./a2a-continuations-store.js", () => ({
  getA2AContinuationTaskOutcome: getA2AContinuationTaskOutcomeMock,
}));

describe("integration campaign recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listDueMock.mockResolvedValue(["campaign-1"]);
    deferRuntimeMock.mockResolvedValue(true);
    getCampaignMock.mockResolvedValue({
      id: "campaign-1",
      integrationTaskId: "task-1",
    });
    getTaskMock.mockResolvedValue({
      id: "task-1",
      platform: "slack",
      externalThreadId: "slack:team:C123:1",
      dispatchScope: "C123",
      status: "processing",
      payload: JSON.stringify({ incoming: { text: "continue" } }),
    });
    dispatchMock.mockResolvedValue("background-acknowledged");
    durableEnabledMock.mockReturnValue(true);
    durableExplicitlyDisabledMock.mockReturnValue(true);
    getNextTaskMock.mockResolvedValue(null);
    getA2AContinuationTaskOutcomeMock.mockResolvedValue("missing");
  });

  it("wakes due campaigns without claiming or executing them", async () => {
    const { recoverDueIntegrationCampaigns } =
      await import("./integration-campaign-recovery.js");

    await expect(
      recoverDueIntegrationCampaigns({
        limit: 5,
        webhookBaseUrl: "https://app.test",
      }),
    ).resolves.toEqual({ selected: 1, dispatched: 1, skipped: 0, failed: 0 });
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        campaignContinuation: true,
      }),
    );
  });

  it("isolates one dispatch failure and continues the bounded batch", async () => {
    listDueMock.mockResolvedValue(["campaign-1", "campaign-2"]);
    getCampaignMock
      .mockResolvedValueOnce({
        id: "campaign-1",
        integrationTaskId: "task-1",
      })
      .mockResolvedValueOnce({
        id: "campaign-2",
        integrationTaskId: "task-2",
      });
    getTaskMock.mockImplementation(async (taskId: string) => ({
      id: taskId,
      platform: "slack",
      externalThreadId: "slack:team:C123:1",
      dispatchScope: "C123",
      status: "processing",
    }));
    dispatchMock
      .mockRejectedValueOnce(new Error("temporary dispatch failure"))
      .mockResolvedValueOnce("background-acknowledged");
    const { recoverDueIntegrationCampaigns } =
      await import("./integration-campaign-recovery.js");

    await expect(recoverDueIntegrationCampaigns({ limit: 2 })).resolves.toEqual(
      { selected: 2, dispatched: 1, skipped: 0, failed: 1 },
    );
    expect(dispatchMock).toHaveBeenCalledTimes(2);
  });

  it("does not wake a campaign after its task left processing", async () => {
    getTaskMock.mockResolvedValueOnce({
      id: "task-1",
      status: "completed",
    });
    const { recoverDueIntegrationCampaigns } =
      await import("./integration-campaign-recovery.js");

    await expect(recoverDueIntegrationCampaigns({})).resolves.toEqual({
      selected: 1,
      dispatched: 0,
      skipped: 1,
      failed: 0,
    });
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("fails closed when the task is no longer in the durable canary scope", async () => {
    durableEnabledMock.mockReturnValueOnce(false);
    const { recoverDueIntegrationCampaigns } =
      await import("./integration-campaign-recovery.js");

    await expect(recoverDueIntegrationCampaigns({})).resolves.toEqual({
      selected: 1,
      dispatched: 0,
      skipped: 1,
      failed: 0,
    });
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(failDisabledMock).toHaveBeenCalledWith("task-1");
  });

  it("leaves a due campaign recoverable when runtime prerequisites are unavailable", async () => {
    durableEnabledMock.mockReturnValueOnce(false);
    durableExplicitlyDisabledMock.mockReturnValueOnce(false);
    const { recoverDueIntegrationCampaigns } =
      await import("./integration-campaign-recovery.js");

    await expect(recoverDueIntegrationCampaigns({})).resolves.toEqual({
      selected: 1,
      dispatched: 0,
      skipped: 1,
      failed: 0,
    });
    expect(failDisabledMock).not.toHaveBeenCalled();
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(deferRuntimeMock).toHaveBeenCalledWith("campaign-1", 60_000);
  });

  it("clears a full paused scan window before a confirmed delivery", async () => {
    const pausedIds = Array.from(
      { length: 20 },
      (_, index) => `paused-${index}`,
    );
    listDueMock
      .mockResolvedValueOnce(pausedIds)
      .mockResolvedValueOnce(["receipt"]);
    getCampaignMock.mockImplementation(async (id: string) => ({
      id,
      integrationTaskId: id,
    }));
    getTaskMock.mockImplementation(async (id: string) => ({
      id,
      platform: "slack",
      externalThreadId: "slack:team:C123:1",
      dispatchScope: "C123",
      status: "processing",
      payload: JSON.stringify(
        id === "receipt"
          ? {
              kind: "response-delivery",
              deliveryReceipt: { status: "delivered" },
            }
          : { incoming: { text: "continue" } },
      ),
    }));
    durableEnabledMock.mockReturnValue(false);
    durableExplicitlyDisabledMock.mockReturnValue(false);
    const { recoverDueIntegrationCampaigns } =
      await import("./integration-campaign-recovery.js");

    await expect(recoverDueIntegrationCampaigns({})).resolves.toMatchObject({
      selected: 20,
      skipped: 20,
    });
    expect(deferRuntimeMock).toHaveBeenCalledTimes(20);
    await expect(recoverDueIntegrationCampaigns({})).resolves.toMatchObject({
      selected: 1,
      dispatched: 1,
    });
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "receipt" }),
    );
  });

  it("still wakes confirmed receipt reconciliation after scope is disabled", async () => {
    durableEnabledMock.mockReturnValueOnce(false);
    getTaskMock.mockResolvedValueOnce({
      id: "task-1",
      platform: "slack",
      externalThreadId: "slack:team:C123:1",
      dispatchScope: "C123",
      status: "processing",
      payload: JSON.stringify({
        kind: "response-delivery",
        deliveryReceipt: { status: "delivered", messageRefs: ["reply-1"] },
      }),
    });
    const { recoverDueIntegrationCampaigns } =
      await import("./integration-campaign-recovery.js");

    await expect(recoverDueIntegrationCampaigns({})).resolves.toEqual({
      selected: 1,
      dispatched: 1,
      skipped: 0,
      failed: 0,
    });
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        campaignContinuation: true,
        allowPortableConfirmedReceiptReconciliation: true,
      }),
    );
    expect(failDisabledMock).not.toHaveBeenCalled();
  });

  it("still wakes finalized A2A parent reconciliation after scope is disabled", async () => {
    durableEnabledMock.mockReturnValueOnce(false);
    getA2AContinuationTaskOutcomeMock.mockResolvedValueOnce(
      "terminal-delivered",
    );
    const { recoverDueIntegrationCampaigns } =
      await import("./integration-campaign-recovery.js");

    await expect(recoverDueIntegrationCampaigns({})).resolves.toEqual({
      selected: 1,
      dispatched: 1,
      skipped: 0,
      failed: 0,
    });
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        campaignContinuation: true,
        allowPortableConfirmedReceiptReconciliation: true,
      }),
    );
    expect(failDisabledMock).not.toHaveBeenCalled();
  });
});
