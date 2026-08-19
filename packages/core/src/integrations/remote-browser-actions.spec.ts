import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createApproval: vi.fn(),
  decideApproval: vi.fn(),
  listDevices: vi.fn(),
  getCapabilities: vi.fn(),
  enqueue: vi.fn(),
  getCommand: vi.fn(),
}));

vi.mock("./computer-supervision-store.js", () => ({
  createComputerApprovalRequest: mocks.createApproval,
  decideComputerApproval: mocks.decideApproval,
}));

vi.mock("./computer-supervision.js", () => ({
  computeComputerActionHash: vi.fn(async () => "a".repeat(64)),
  computerOperationRequiresApproval: (operationClass: string) =>
    operationClass.endsWith(".control"),
}));

vi.mock("./remote-devices-store.js", () => ({
  listRemoteDevicesForOwner: mocks.listDevices,
  getRemoteComputerCapabilities: mocks.getCapabilities,
}));

vi.mock("./remote-commands-store.js", () => ({
  enqueueComputerCommand: mocks.enqueue,
  getRemoteCommand: mocks.getCommand,
}));

const device = {
  id: "device-1",
  ownerEmail: "owner@example.com",
  orgId: "org-1",
  label: "Agent Native for Chrome",
  platform: "chrome-extension",
  appVersion: "0.1.0",
  hostName: null,
  metadata: {
    browserSession: {
      version: 1,
      handle: "bsn_example",
      origin: "https://example.com",
      title: "Example",
    },
  },
  deviceTokenHash: "hash",
  lastSeenAt: Date.now(),
  status: "active",
  revokedAt: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

async function loadActions() {
  const { createRemoteBrowserActionEntries } =
    await import("./remote-browser-actions.js");
  return createRemoteBrowserActionEntries({
    getOwnerEmail: () => "owner@example.com",
    getOrgId: () => "org-1",
  });
}

describe("remote browser agent actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listDevices.mockResolvedValue([device]);
    mocks.getCapabilities.mockReturnValue({
      browser: { observe: true, control: true },
    });
    mocks.enqueue.mockImplementation(async ({ envelope }) => ({
      id: "command-1",
      deviceId: device.id,
      ownerEmail: device.ownerEmail,
      orgId: device.orgId,
      kind: "computer-operation",
      params: { envelope },
      status: "completed",
      result: { outcome: { state: "complete" } },
      platform: "browser",
      externalThreadId: null,
      computerOperation: envelope,
      attempts: 1,
      nextCheckAt: Date.now(),
      claimedAt: Date.now(),
      completedAt: Date.now(),
      errorMessage: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));
  });

  it("lists only the opaque page session and advertised capabilities", async () => {
    const actions = await loadActions();
    const result = await actions["list-remote-browser-devices"]!.run(
      {},
      { caller: "tool" },
    );

    expect(result).toMatchObject({
      ok: true,
      sessions: [
        {
          deviceId: "device-1",
          sessionHandle: "bsn_example",
          origin: "https://example.com",
          canRead: true,
          canControl: true,
        },
      ],
    });
  });

  it("sends Tier 0 reads without creating a control approval", async () => {
    const actions = await loadActions();
    await actions["read-remote-browser-page"]!.run(
      {
        action: "read",
        sessionHandle: "bsn_example",
      },
      { caller: "tool", threadId: "thread-1", runId: "run-1" },
    );

    const envelope = mocks.enqueue.mock.calls[0]![0].envelope;
    expect(envelope).toMatchObject({
      taskId: "bsn_example",
      runId: "thread-1",
      operationClass: "browser.observe",
      action: {
        type: "browser.read",
        target: { sessionHandle: "bsn_example" },
      },
      approval: { id: null, actionHash: "a".repeat(64) },
    });
    expect(mocks.createApproval).not.toHaveBeenCalled();
  });

  it("binds a human-approved attach to the relay before enqueueing", async () => {
    mocks.createApproval.mockResolvedValue({ id: "approval-1" });
    mocks.decideApproval.mockResolvedValue({ id: "approval-1" });
    const actions = await loadActions();
    const control = actions["control-remote-browser"]!;

    expect(
      await control.needsApproval?.(
        { action: "attach", sessionHandle: "bsn_example" },
        { caller: "tool" },
      ),
    ).toBe(true);

    await control.run(
      { action: "attach", sessionHandle: "bsn_example" },
      {
        caller: "tool",
        threadId: "thread-1",
        runId: "run-1",
        approvedToolCallKey: "control-remote-browser:approved",
      },
    );

    expect(mocks.createApproval).toHaveBeenCalledOnce();
    expect(mocks.decideApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "approval-1",
        decision: "approved",
        actionHash: "a".repeat(64),
      }),
    );
    expect(mocks.enqueue.mock.calls[0]![0].envelope).toMatchObject({
      runId: "thread-1",
      operationClass: "browser.control",
      action: {
        type: "browser.attach",
        target: { sessionHandle: "bsn_example" },
      },
      approval: { id: "approval-1" },
    });
  });

  it("rejects control that did not pass through the human approval gate", async () => {
    const actions = await loadActions();

    await expect(
      actions["control-remote-browser"]!.run(
        { action: "attach", sessionHandle: "bsn_example" },
        { caller: "tool", threadId: "thread-1", runId: "run-1" },
      ),
    ).rejects.toThrow("Browser control requires human approval");

    expect(mocks.createApproval).not.toHaveBeenCalled();
    expect(mocks.decideApproval).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("queues approved background tab creation on the current origin", async () => {
    mocks.createApproval.mockResolvedValue({ id: "approval-2" });
    mocks.decideApproval.mockResolvedValue({ id: "approval-2" });
    const actions = await loadActions();

    await actions["control-remote-browser"]!.run(
      { action: "open-tab", url: "https://example.com/next" },
      {
        caller: "tool",
        threadId: "thread-1",
        runId: "run-1",
        approvedToolCallKey: "control-remote-browser:approved",
      },
    );

    expect(mocks.enqueue.mock.calls[0]![0].envelope).toMatchObject({
      operationClass: "browser.control",
      action: {
        type: "browser.open-tab",
        input: { url: "https://example.com/next" },
      },
    });
  });
});
