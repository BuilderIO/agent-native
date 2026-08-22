import { beforeEach, describe, expect, it, vi } from "vitest";

const canUpdateAutomationResourceMock = vi.hoisted(() => vi.fn());
const resourceGetByPathMock = vi.hoisted(() => vi.fn());
const startAutomationRunMock = vi.hoisted(() => vi.fn());
const listUnclaimedAutomationRunsMock = vi.hoisted(() => vi.fn());
const fireInternalDispatchMock = vi.hoisted(() => vi.fn());

vi.mock("../automations/service.js", () => ({
  canUpdateAutomationResource: canUpdateAutomationResourceMock,
}));

vi.mock("../resources/store.js", () => ({
  organizationResourceOwner: (orgId: string) => `__organization__:${orgId}`,
  resourceGetByPath: resourceGetByPathMock,
}));

vi.mock("./run-history.js", () => ({
  startAutomationRun: startAutomationRunMock,
  listUnclaimedAutomationRuns: listUnclaimedAutomationRunsMock,
}));

vi.mock("../server/self-dispatch.js", () => ({
  fireInternalDispatch: fireInternalDispatchMock,
}));

vi.mock("../db/client.js", () => ({ isLocalDatabase: () => true }));

vi.mock("../agent/durable-background.js", () => ({
  AGENT_CHAT_BACKGROUND_RUN_FIELD: "__backgroundRun",
  dispatchPathTargetsNetlifyBackgroundFunction: () => false,
  resolveAgentChatProcessRunDispatchPath: () => "/_agent-native/process-run",
}));

import { queueAutomationRunNow } from "./run-now.js";

function resourceAt(path: string) {
  return {
    id: "resource-1",
    path,
    owner: "__organization__:org-1",
    content: `---\ndomain: factory\n---\nObserve the channel.\n`,
  };
}

const organizationRun = {
  userEmail: "alice@example.com",
  orgId: "org-1",
  appId: "factory",
  scope: "organization" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  canUpdateAutomationResourceMock.mockResolvedValue(true);
  listUnclaimedAutomationRunsMock.mockResolvedValue([]);
  startAutomationRunMock.mockResolvedValue("history-1");
  fireInternalDispatchMock.mockResolvedValue(undefined);
});

describe("queueAutomationRunNow", () => {
  // Per-factory automations live at jobs/factories/<factoryId>/<name>.md, so
  // their name contains a slash and cannot round-trip through `name`.
  it("queues a nested automation by path", async () => {
    const path = "jobs/factories/enzo-test-factory-3/factory-slack-feedback.md";
    resourceGetByPathMock.mockResolvedValue(resourceAt(path));

    const result = await queueAutomationRunNow({ ...organizationRun, path });

    expect(resourceGetByPathMock).toHaveBeenCalledWith(
      "__organization__:org-1",
      path,
    );
    expect(startAutomationRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        automation: "factories/enzo-test-factory-3/factory-slack-feedback",
        path,
      }),
    );
    expect(result).toEqual({
      queued: true,
      runId: "history-1",
      automationRunId: "history-1",
    });
  });

  it("still resolves a flat name to its jobs/ path", async () => {
    resourceGetByPathMock.mockResolvedValue(resourceAt("jobs/digest.md"));

    await queueAutomationRunNow({ ...organizationRun, name: "digest" });

    expect(resourceGetByPathMock).toHaveBeenCalledWith(
      "__organization__:org-1",
      "jobs/digest.md",
    );
    expect(startAutomationRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ automation: "digest", path: "jobs/digest.md" }),
    );
  });

  it("dispatches new and recovered runs to the inbound local host", async () => {
    const requestHeaders = new Headers({ host: "localhost:8080" });
    resourceGetByPathMock.mockResolvedValue(resourceAt("jobs/digest.md"));
    listUnclaimedAutomationRunsMock.mockResolvedValue([
      { id: "history-stale" },
    ]);

    await queueAutomationRunNow({
      ...organizationRun,
      name: "digest",
      requestHeaders,
    });

    expect(fireInternalDispatchMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        taskId: "history-stale",
        event: { headers: requestHeaders },
      }),
    );
    expect(fireInternalDispatchMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        taskId: "history-1",
        event: { headers: requestHeaders },
      }),
    );
  });

  it("rejects a name that carries a path separator", async () => {
    await expect(
      queueAutomationRunNow({
        ...organizationRun,
        name: "factories/f3/factory-slack-channel",
      }),
    ).rejects.toThrow("A valid automation name is required.");
    expect(resourceGetByPathMock).not.toHaveBeenCalled();
  });

  it("rejects a path that escapes the jobs/ tree", async () => {
    await expect(
      queueAutomationRunNow({
        ...organizationRun,
        path: "jobs/../secrets.md",
      }),
    ).rejects.toThrow("A valid automation path is required.");
    expect(resourceGetByPathMock).not.toHaveBeenCalled();
  });

  it("rejects a path outside jobs/", async () => {
    await expect(
      queueAutomationRunNow({ ...organizationRun, path: "secrets/keys.md" }),
    ).rejects.toThrow("A valid automation path is required.");
    expect(resourceGetByPathMock).not.toHaveBeenCalled();
  });

  it("refuses to guess when both a name and a path are given", async () => {
    await expect(
      queueAutomationRunNow({
        ...organizationRun,
        name: "digest",
        path: "jobs/other.md",
      }),
    ).rejects.toThrow("Specify either an automation name or a path, not both.");
    expect(resourceGetByPathMock).not.toHaveBeenCalled();
  });
});
