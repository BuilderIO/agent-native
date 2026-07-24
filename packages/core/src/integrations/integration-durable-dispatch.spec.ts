import { beforeEach, describe, expect, it, vi } from "vitest";

const fireInternalDispatchMock = vi.hoisted(() => vi.fn());
const recordDispatchAttemptMock = vi.hoisted(() => vi.fn());

vi.mock("../server/self-dispatch.js", () => ({
  fireInternalDispatch: fireInternalDispatchMock,
}));

vi.mock("./pending-tasks-store.js", () => ({
  recordPendingTaskDispatchAttempt: recordDispatchAttemptMock,
}));

describe("durable integration dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    fireInternalDispatchMock.mockResolvedValue(undefined);
    recordDispatchAttemptMock.mockResolvedValue(undefined);
    vi.stubEnv("NETLIFY", "true");
    vi.stubEnv("A2A_SECRET", "test-secret");
  });

  it("keeps the portable path as the default", async () => {
    const { dispatchPendingIntegrationTask } =
      await import("./integration-durable-dispatch.js");

    await expect(
      dispatchPendingIntegrationTask({
        taskId: "task-1",
        task: { platform: "slack", externalThreadId: "slack:team:C123:1" },
        baseUrl: "https://app.test",
      }),
    ).resolves.toBe("portable-unconfirmed");

    expect(fireInternalDispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/_agent-native/integrations/process-task",
      }),
    );
  });

  it("uses an acknowledged Netlify handoff for an enabled Slack scope", async () => {
    vi.stubEnv("AGENT_INTEGRATION_DURABLE_DISPATCH", "true");
    vi.stubEnv("AGENT_INTEGRATION_DURABLE_DISPATCH_SCOPES", "slack:C123");
    const { dispatchPendingIntegrationTask } =
      await import("./integration-durable-dispatch.js");

    await expect(
      dispatchPendingIntegrationTask({
        taskId: "task-2",
        task: { platform: "slack", externalThreadId: "slack:team:C123:1" },
        baseUrl: "https://app.test",
      }),
    ).resolves.toBe("background-acknowledged");

    expect(fireInternalDispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/.netlify/functions/server-agent-background",
        awaitResponse: true,
        body: { __agentNativeProcessor: "integration" },
      }),
    );
    expect(recordDispatchAttemptMock).toHaveBeenCalledWith(
      "task-2",
      "background-acknowledged",
    );
  });

  it("uses the durable handoff when only Netlify's runtime SITE_ID is present", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("NETLIFY", "");
    vi.stubEnv("NETLIFY_LOCAL", "");
    vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", "");
    vi.stubEnv("SITE_ID", "00000000-0000-0000-0000-000000000000");
    vi.stubEnv("A2A_SECRET", "test-secret");
    vi.stubEnv("AGENT_INTEGRATION_DURABLE_DISPATCH", "true");
    vi.stubEnv("AGENT_INTEGRATION_DURABLE_DISPATCH_SCOPES", "slack:C123");
    const { dispatchPendingIntegrationTask } =
      await import("./integration-durable-dispatch.js");

    await expect(
      dispatchPendingIntegrationTask({
        taskId: "task-runtime-site-id",
        task: { platform: "slack", externalThreadId: "slack:team:C123:1" },
        baseUrl: "https://app.test",
      }),
    ).resolves.toBe("background-acknowledged");

    expect(fireInternalDispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/.netlify/functions/server-agent-background",
        awaitResponse: true,
      }),
    );
  });

  it("does not broaden a scoped rollout", async () => {
    vi.stubEnv("AGENT_INTEGRATION_DURABLE_DISPATCH", "true");
    vi.stubEnv("AGENT_INTEGRATION_DURABLE_DISPATCH_SCOPES", "slack:C999");
    const { dispatchPendingIntegrationTask } =
      await import("./integration-durable-dispatch.js");

    await dispatchPendingIntegrationTask({
      taskId: "task-3",
      task: { platform: "slack", externalThreadId: "slack:team:C123:1" },
      baseUrl: "https://app.test",
    });

    expect(fireInternalDispatchMock).toHaveBeenCalledOnce();
    expect(fireInternalDispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/_agent-native/integrations/process-task",
      }),
    );
  });

  it("falls back to the portable processor when the background handoff fails", async () => {
    vi.stubEnv("AGENT_INTEGRATION_DURABLE_DISPATCH", "true");
    fireInternalDispatchMock
      .mockRejectedValueOnce(new Error("background unavailable"))
      .mockResolvedValueOnce(undefined);
    const { dispatchPendingIntegrationTask } =
      await import("./integration-durable-dispatch.js");

    await expect(
      dispatchPendingIntegrationTask({
        taskId: "task-4",
        task: { platform: "slack", externalThreadId: "slack:team:C123:1" },
        baseUrl: "https://app.test",
      }),
    ).resolves.toBe("portable-unconfirmed");

    expect(fireInternalDispatchMock).toHaveBeenCalledTimes(2);
    expect(fireInternalDispatchMock.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        path: "/_agent-native/integrations/process-task",
      }),
    );
  });
});
