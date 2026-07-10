import { afterEach, describe, expect, it, vi } from "vitest";

import { createIntegrationsPlugin } from "./plugin.js";

const getSessionMock = vi.hoisted(() => vi.fn());
const getOrgContextMock = vi.hoisted(() => vi.fn());
const createRemoteDeviceMock = vi.hoisted(() => vi.fn());
const getRemoteDeviceForOwnerMock = vi.hoisted(() => vi.fn());
const listRemoteDevicesForOwnerMock = vi.hoisted(() => vi.fn());
const revokeRemoteDeviceForOwnerMock = vi.hoisted(() => vi.fn());
const unregisterRemoteDeviceMock = vi.hoisted(() => vi.fn());
const updateRemoteDeviceDetailsMock = vi.hoisted(() => vi.fn());
const authenticateRemoteDeviceTokenMock = vi.hoisted(() => vi.fn());
const getRemoteComputerCapabilitiesMock = vi.hoisted(() => vi.fn());
const claimNextComputerCommandMock = vi.hoisted(() => vi.fn());
const claimNextRemoteCommandMock = vi.hoisted(() => vi.fn());
const enqueueComputerCommandMock = vi.hoisted(() => vi.fn());
const enqueueRemoteCommandMock = vi.hoisted(() => vi.fn());
const createComputerApprovalRequestMock = vi.hoisted(() => vi.fn());
const decideComputerApprovalMock = vi.hoisted(() => vi.fn());
const listComputerApprovalsForOwnerMock = vi.hoisted(() => vi.fn());
const listRemoteCommandsForOwnerMock = vi.hoisted(() => vi.fn());
const updateRemoteCommandResultMock = vi.hoisted(() => vi.fn());
const insertRemoteRunEventsMock = vi.hoisted(() => vi.fn());
const listRemoteRunEventsMock = vi.hoisted(() => vi.fn());
const listRemotePushRegistrationsForOwnerMock = vi.hoisted(() => vi.fn());
const upsertRemotePushRegistrationMock = vi.hoisted(() => vi.fn());
const unregisterRemotePushRegistrationForOwnerMock = vi.hoisted(() => vi.fn());
const listRemotePushNotificationsForOwnerMock = vi.hoisted(() => vi.fn());
const queueRemotePushNotificationsMock = vi.hoisted(() => vi.fn());

vi.mock("../deploy/route-discovery.js", () => ({
  getMissingDefaultPlugins: vi.fn(async () => []),
}));

vi.mock("../server/auth.js", () => ({
  getSession: getSessionMock,
}));

vi.mock("../org/context.js", () => ({
  getOrgContext: getOrgContextMock,
}));

vi.mock("./pending-tasks-retry-job.js", () => ({
  startPendingTasksRetryJob: vi.fn(),
}));

vi.mock("./google-docs-poller.js", () => ({
  startGoogleDocsPoller: vi.fn(),
  handlePushNotification: vi.fn(),
}));

vi.mock("./a2a-continuation-processor.js", () => ({
  processA2AContinuationById: vi.fn(),
  processDueA2AContinuations: vi.fn(async () => {}),
}));

vi.mock("./remote-retry-job.js", () => ({
  startRemoteCommandsRetryJob: vi.fn(),
}));

vi.mock("./remote-devices-store.js", () => ({
  authenticateRemoteDeviceToken: authenticateRemoteDeviceTokenMock,
  createRemoteDevice: createRemoteDeviceMock,
  getRemoteComputerCapabilities: getRemoteComputerCapabilitiesMock,
  getRemoteDeviceForOwner: getRemoteDeviceForOwnerMock,
  listRemoteDevicesForOwner: listRemoteDevicesForOwnerMock,
  revokeRemoteDeviceForOwner: revokeRemoteDeviceForOwnerMock,
  unregisterRemoteDevice: unregisterRemoteDeviceMock,
  updateRemoteDeviceDetails: updateRemoteDeviceDetailsMock,
  toPublicRemoteDevice: (device: any) => {
    const { deviceTokenHash, ...publicDevice } = device;
    return publicDevice;
  },
}));

vi.mock("./remote-commands-store.js", () => ({
  claimNextComputerCommand: claimNextComputerCommandMock,
  claimNextRemoteCommand: claimNextRemoteCommandMock,
  enqueueComputerCommand: enqueueComputerCommandMock,
  enqueueRemoteCommand: enqueueRemoteCommandMock,
  isRemoteCommandKind: (value: unknown) =>
    [
      "create-run",
      "list-runs",
      "get-run",
      "append-followup",
      "approve",
      "deny",
      "stop",
      "status",
    ].includes(String(value)),
  listRemoteCommandsForOwner: listRemoteCommandsForOwnerMock,
  updateRemoteCommandResult: updateRemoteCommandResultMock,
}));

vi.mock("./computer-supervision-store.js", () => ({
  createComputerApprovalRequest: createComputerApprovalRequestMock,
  decideComputerApproval: decideComputerApprovalMock,
  listComputerApprovalsForOwner: listComputerApprovalsForOwnerMock,
}));

vi.mock("./computer-supervision.js", () => ({
  ComputerSupervisionError: class ComputerSupervisionError extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

vi.mock("./remote-run-events-store.js", () => ({
  insertRemoteRunEvents: insertRemoteRunEventsMock,
  listRemoteRunEvents: listRemoteRunEventsMock,
}));

vi.mock("./remote-push-store.js", () => ({
  listRemotePushNotificationsForOwner: listRemotePushNotificationsForOwnerMock,
  listRemotePushRegistrationsForOwner: listRemotePushRegistrationsForOwnerMock,
  queueRemotePushNotifications: queueRemotePushNotificationsMock,
  toPublicRemotePushRegistration: (registration: any) => {
    const { token, tokenHash, ...publicRegistration } = registration;
    return publicRegistration;
  },
  unregisterRemotePushRegistrationForOwner:
    unregisterRemotePushRegistrationForOwnerMock,
  upsertRemotePushRegistration: upsertRemotePushRegistrationMock,
}));

function createNitroApp() {
  return { h3: { "~middleware": [] as any[] } };
}

async function dispatch(
  nitroApp: any,
  pathname: string,
  method = "GET",
  body?: unknown,
  headers?: Record<string, string>,
) {
  const url = `https://app.test${pathname}`;
  const requestBody = body === undefined ? undefined : JSON.stringify(body);
  const requestHeaders = {
    host: "app.test",
    "x-forwarded-proto": "https",
    ...(requestBody ? { "content-type": "application/json" } : {}),
    ...(headers ?? {}),
  };
  const event = {
    method,
    url: new URL(url),
    path: pathname,
    context: {},
    req: new Request(url, {
      method,
      body: requestBody,
      headers: requestHeaders,
    }),
    res: {
      status: 200,
      headers: new Headers(),
    },
    node: {
      req: {
        method,
        url: pathname,
        headers: requestHeaders,
      },
      res: {
        statusCode: 200,
        setHeader() {},
      },
    },
  };
  let index = 0;
  const next = async (): Promise<unknown> => {
    const middleware = nitroApp.h3["~middleware"][index++];
    if (!middleware) return { fellThrough: true };
    return middleware(event, next);
  };
  const responseBody = await next();
  return { body: responseBody, status: event.res.status };
}

describe("remote integration plugin routes", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("registers a remote device with session auth and returns the raw token once", async () => {
    getSessionMock.mockResolvedValueOnce({ email: "alice@example.com" });
    getOrgContextMock.mockResolvedValueOnce({ orgId: "org-1" });
    createRemoteDeviceMock.mockResolvedValueOnce({
      token: "anr_raw-token",
      device: {
        id: "device-1",
        ownerEmail: "alice@example.com",
        orgId: "org-1",
        label: "Studio Mac",
        platform: null,
        appVersion: null,
        hostName: null,
        metadata: null,
        deviceTokenHash: "hashed",
        lastSeenAt: 1,
        status: "active",
        revokedAt: null,
        createdAt: 1,
        updatedAt: 1,
      },
    });
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({ adapters: [] })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/integrations/remote/register",
      "POST",
      { label: "Studio Mac" },
    );

    expect(result.status).toBe(200);
    expect(createRemoteDeviceMock).toHaveBeenCalledWith({
      ownerEmail: "alice@example.com",
      orgId: "org-1",
      label: "Studio Mac",
      platform: undefined,
      appVersion: undefined,
      hostName: undefined,
      metadata: null,
    });
    expect(result.body).toEqual({
      token: "anr_raw-token",
      device: expect.not.objectContaining({ deviceTokenHash: "hashed" }),
    });
  });

  it("requires a registered device bearer token for polling", async () => {
    authenticateRemoteDeviceTokenMock.mockResolvedValueOnce(null);
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({ adapters: [] })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/integrations/remote/poll?waitMs=0",
      "GET",
    );

    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: "unauthorized" });
    expect(claimNextRemoteCommandMock).not.toHaveBeenCalled();
  });

  it("long-poll claims the next command for the authenticated device", async () => {
    authenticateRemoteDeviceTokenMock.mockResolvedValueOnce({
      id: "device-1",
      ownerEmail: "alice@example.com",
      orgId: null,
      label: "Studio Mac",
      deviceTokenHash: "hashed",
      lastSeenAt: 1,
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    claimNextRemoteCommandMock.mockResolvedValueOnce({
      id: "cmd-1",
      deviceId: "device-1",
      kind: "create-run",
      status: "claimed",
      params: { prompt: "go" },
    });
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({ adapters: [] })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/integrations/remote/poll",
      "POST",
      { waitMs: 0 },
      { authorization: "Bearer anr_raw-token" },
    );

    expect(result.status).toBe(200);
    expect(authenticateRemoteDeviceTokenMock).toHaveBeenCalledWith(
      "anr_raw-token",
    );
    expect(claimNextRemoteCommandMock).toHaveBeenCalledWith("device-1");
    expect(result.body).toEqual({
      command: expect.objectContaining({ id: "cmd-1" }),
    });
  });

  it("claims only computer operations matching advertised device capabilities", async () => {
    const device = {
      id: "device-1",
      ownerEmail: "alice@example.com",
      orgId: "org-1",
      label: "Studio Mac",
      metadata: null,
      deviceTokenHash: "hashed",
      lastSeenAt: 1,
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    };
    authenticateRemoteDeviceTokenMock.mockResolvedValueOnce(device);
    updateRemoteDeviceDetailsMock.mockResolvedValueOnce({
      ...device,
      metadata: {
        computerCapabilities: {
          browser: { observe: true, control: true },
        },
      },
    });
    getRemoteComputerCapabilitiesMock.mockReturnValueOnce({
      browser: { observe: true, control: true },
    });
    claimNextComputerCommandMock.mockResolvedValueOnce({
      id: "computer-command-1",
      deviceId: "device-1",
      kind: "computer-operation",
      status: "claimed",
      params: {},
    });
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({ adapters: [] })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/integrations/remote/poll",
      "POST",
      {
        waitMs: 0,
        computerCapabilities: {
          browser: { observe: true, control: true },
        },
      },
      { authorization: "Bearer anr_raw-token" },
    );

    expect(claimNextComputerCommandMock).toHaveBeenCalledWith({
      deviceId: "device-1",
      ownerEmail: "alice@example.com",
      orgId: "org-1",
      operationClasses: ["browser.observe", "browser.control"],
    });
    expect(claimNextRemoteCommandMock).not.toHaveBeenCalled();
    expect(result.body).toEqual({
      command: expect.objectContaining({ id: "computer-command-1" }),
    });
  });

  it("uses generic polling when no computer capability is advertised", async () => {
    authenticateRemoteDeviceTokenMock.mockResolvedValueOnce({
      id: "device-1",
      ownerEmail: "alice@example.com",
      orgId: null,
      label: "Studio Mac",
      metadata: null,
      deviceTokenHash: "hashed",
      lastSeenAt: 1,
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    getRemoteComputerCapabilitiesMock.mockReturnValueOnce(null);
    claimNextRemoteCommandMock.mockResolvedValueOnce({
      id: "cmd-1",
      deviceId: "device-1",
      kind: "status",
      status: "claimed",
      params: {},
    });
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({ adapters: [] })(nitroApp);

    await dispatch(
      nitroApp,
      "/_agent-native/integrations/remote/poll?waitMs=0",
      "GET",
      undefined,
      { authorization: "Bearer anr_raw-token" },
    );

    expect(claimNextComputerCommandMock).not.toHaveBeenCalled();
    expect(claimNextRemoteCommandMock).toHaveBeenCalledWith("device-1");
  });

  it("scopes session enqueue to the user's registered device", async () => {
    getSessionMock.mockResolvedValueOnce({ email: "alice@example.com" });
    getOrgContextMock.mockResolvedValueOnce({ orgId: "org-1" });
    getRemoteDeviceForOwnerMock.mockResolvedValueOnce(null);
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({ adapters: [] })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/integrations/remote/enqueue",
      "POST",
      {
        deviceId: "device-owned-by-someone-else",
        kind: "create-run",
        params: { prompt: "nope" },
      },
    );

    expect(result.status).toBe(404);
    expect(getRemoteDeviceForOwnerMock).toHaveBeenCalledWith({
      id: "device-owned-by-someone-else",
      ownerEmail: "alice@example.com",
      orgId: "org-1",
    });
    expect(enqueueRemoteCommandMock).not.toHaveBeenCalled();
  });

  it("creates and decides scoped computer approvals", async () => {
    getSessionMock.mockResolvedValue({ email: "alice@example.com" });
    getOrgContextMock.mockResolvedValue({ orgId: "org-1" });
    createComputerApprovalRequestMock.mockResolvedValueOnce({
      id: "approval-1",
      status: "pending",
    });
    decideComputerApprovalMock.mockResolvedValueOnce({
      id: "approval-1",
      status: "approved",
    });
    const envelope = { version: 1, taskId: "task-1" };
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({ adapters: [] })(nitroApp);

    const created = await dispatch(
      nitroApp,
      "/_agent-native/integrations/remote/computer/approvals",
      "POST",
      { deviceId: "device-1", envelope },
    );
    expect(createComputerApprovalRequestMock).toHaveBeenCalledWith({
      ownerEmail: "alice@example.com",
      orgId: "org-1",
      deviceId: "device-1",
      envelope,
    });
    expect(created.body).toEqual({
      approval: expect.objectContaining({ id: "approval-1" }),
    });

    const decided = await dispatch(
      nitroApp,
      "/_agent-native/integrations/remote/computer/approvals/approval-1/decision",
      "POST",
      { decision: "approved", actionHash: "a".repeat(64) },
    );
    expect(decideComputerApprovalMock).toHaveBeenCalledWith({
      id: "approval-1",
      ownerEmail: "alice@example.com",
      orgId: "org-1",
      actionHash: "a".repeat(64),
      decision: "approved",
      decidedBy: "alice@example.com",
      result: null,
    });
    expect(decided.body).toEqual({
      approval: expect.objectContaining({ status: "approved" }),
    });
  });

  it("lists approvals and enqueues scoped typed computer commands", async () => {
    getSessionMock.mockResolvedValue({ email: "alice@example.com" });
    getOrgContextMock.mockResolvedValue({ orgId: "org-1" });
    listComputerApprovalsForOwnerMock.mockResolvedValueOnce([
      { id: "approval-1", status: "approved" },
    ]);
    enqueueComputerCommandMock.mockResolvedValueOnce({
      id: "computer-command-1",
      kind: "computer-operation",
      status: "pending",
    });
    const envelope = { version: 1, taskId: "task-1" };
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({ adapters: [] })(nitroApp);

    const listed = await dispatch(
      nitroApp,
      "/_agent-native/integrations/remote/computer/approvals?taskId=task-1",
      "GET",
    );
    expect(listComputerApprovalsForOwnerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: "alice@example.com",
        orgId: "org-1",
        taskId: "task-1",
      }),
    );
    expect(listed.body).toEqual({ approvals: [expect.any(Object)] });

    const enqueued = await dispatch(
      nitroApp,
      "/_agent-native/integrations/remote/computer/commands",
      "POST",
      { deviceId: "device-1", envelope, platform: "desktop" },
    );
    expect(enqueueComputerCommandMock).toHaveBeenCalledWith({
      deviceId: "device-1",
      ownerEmail: "alice@example.com",
      orgId: "org-1",
      envelope,
      platform: "desktop",
    });
    expect(enqueued.body).toEqual({
      command: expect.objectContaining({ id: "computer-command-1" }),
    });
  });

  it("preserves permission mode when enqueuing remote code follow-ups", async () => {
    getSessionMock.mockResolvedValueOnce({ email: "alice@example.com" });
    getOrgContextMock.mockResolvedValueOnce({ orgId: "org-1" });
    listRemoteCommandsForOwnerMock.mockResolvedValueOnce([]);
    listRemoteDevicesForOwnerMock.mockResolvedValueOnce([
      {
        id: "device-1",
        ownerEmail: "alice@example.com",
        orgId: "org-1",
        label: "Studio Mac",
        deviceTokenHash: "hashed",
        lastSeenAt: Date.now(),
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    enqueueRemoteCommandMock.mockResolvedValueOnce({
      id: "cmd-1",
      deviceId: "device-1",
      kind: "append-followup",
      status: "pending",
      params: {},
      result: null,
      completedAt: null,
    });
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({ adapters: [] })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/integrations/remote/enqueue",
      "POST",
      {
        operation: "code-agent.run.follow-up",
        payload: {
          runId: "run-1",
          prompt: "Stay read-only",
          hostId: "device-1",
          permissionMode: "read-only",
        },
      },
    );

    expect(result.status).toBe(200);
    expect(enqueueRemoteCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "append-followup",
        params: expect.objectContaining({
          runId: "run-1",
          prompt: "Stay read-only",
          permissionMode: "read-only",
        }),
      }),
    );
  });

  it("lists scoped host details without exposing device token hashes", async () => {
    getSessionMock.mockResolvedValueOnce({ email: "alice@example.com" });
    getOrgContextMock.mockResolvedValueOnce({ orgId: "org-1" });
    listRemoteDevicesForOwnerMock.mockResolvedValueOnce([
      {
        id: "device-1",
        ownerEmail: "alice@example.com",
        orgId: "org-1",
        label: "Studio Mac",
        platform: "darwin",
        appVersion: "1.2.3",
        hostName: "studio",
        metadata: { arch: "arm64" },
        deviceTokenHash: "hashed",
        lastSeenAt: Date.now(),
        status: "active",
        revokedAt: null,
        createdAt: 1,
        updatedAt: 2,
      },
    ]);
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({ adapters: [] })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/integrations/remote/hosts",
      "GET",
    );

    expect(result.status).toBe(200);
    expect(listRemoteDevicesForOwnerMock).toHaveBeenCalledWith({
      ownerEmail: "alice@example.com",
      orgId: "org-1",
      limit: 50,
    });
    expect(result.body).toEqual({
      hosts: [
        expect.objectContaining({
          id: "device-1",
          platform: "darwin",
          appVersion: "1.2.3",
          hostName: "studio",
          device: expect.not.objectContaining({ deviceTokenHash: "hashed" }),
        }),
      ],
      devices: [
        expect.objectContaining({
          id: "device-1",
          device: expect.not.objectContaining({ deviceTokenHash: "hashed" }),
        }),
      ],
    });
  });

  it("revokes a device only through the scoped owner session", async () => {
    getSessionMock.mockResolvedValueOnce({ email: "alice@example.com" });
    getOrgContextMock.mockResolvedValueOnce({ orgId: "org-1" });
    revokeRemoteDeviceForOwnerMock.mockResolvedValueOnce({
      id: "device-1",
      ownerEmail: "alice@example.com",
      orgId: "org-1",
      label: "Studio Mac",
      platform: null,
      appVersion: null,
      hostName: null,
      metadata: null,
      deviceTokenHash: "hashed",
      lastSeenAt: 1,
      status: "inactive",
      revokedAt: 2,
      createdAt: 1,
      updatedAt: 2,
    });
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({ adapters: [] })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/integrations/remote/devices/device-1/revoke",
      "POST",
    );

    expect(result.status).toBe(200);
    expect(revokeRemoteDeviceForOwnerMock).toHaveBeenCalledWith({
      id: "device-1",
      ownerEmail: "alice@example.com",
      orgId: "org-1",
    });
    expect(result.body).toEqual({
      ok: true,
      device: expect.not.objectContaining({ deviceTokenHash: "hashed" }),
    });
  });

  it("lets an authenticated device unregister itself", async () => {
    authenticateRemoteDeviceTokenMock.mockResolvedValueOnce({
      id: "device-1",
      ownerEmail: "alice@example.com",
      orgId: null,
      label: "Studio Mac",
      platform: null,
      appVersion: null,
      hostName: null,
      metadata: null,
      deviceTokenHash: "hashed",
      lastSeenAt: 1,
      status: "active",
      revokedAt: null,
      createdAt: 1,
      updatedAt: 1,
    });
    unregisterRemoteDeviceMock.mockResolvedValueOnce(true);
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({ adapters: [] })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/integrations/remote/unregister",
      "POST",
      {},
      { authorization: "Bearer anr_raw-token" },
    );

    expect(result.status).toBe(200);
    expect(unregisterRemoteDeviceMock).toHaveBeenCalledWith("device-1");
    expect(result.body).toEqual({ ok: true, deviceId: "device-1" });
  });

  it("registers mobile push tokens without returning the raw token", async () => {
    getSessionMock.mockResolvedValueOnce({ email: "alice@example.com" });
    getOrgContextMock.mockResolvedValueOnce({ orgId: "org-1" });
    upsertRemotePushRegistrationMock.mockResolvedValueOnce({
      id: "push-1",
      ownerEmail: "alice@example.com",
      orgId: "org-1",
      provider: "apns",
      platform: "ios",
      clientDeviceId: "phone-1",
      label: "Alice iPhone",
      token: "raw-token",
      tokenHash: "hashed-token",
      status: "active",
      lastSeenAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({ adapters: [] })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/integrations/remote/push/register",
      "POST",
      {
        provider: "apns",
        platform: "ios",
        token: "raw-token",
        clientDeviceId: "phone-1",
        label: "Alice iPhone",
      },
    );

    expect(result.status).toBe(200);
    expect(upsertRemotePushRegistrationMock).toHaveBeenCalledWith({
      ownerEmail: "alice@example.com",
      orgId: "org-1",
      provider: "apns",
      token: "raw-token",
      platform: "ios",
      clientDeviceId: "phone-1",
      label: "Alice iPhone",
    });
    expect(result.body).toEqual({
      registration: expect.not.objectContaining({
        token: "raw-token",
        tokenHash: "hashed-token",
      }),
    });
  });

  it("smokes the desktop/mobile relay route contract end to end", async () => {
    const device = {
      id: "device-1",
      ownerEmail: "alice@example.com",
      orgId: "org-1",
      label: "Studio Mac",
      platform: "darwin",
      appVersion: "1.2.3",
      hostName: "studio",
      metadata: { arch: "arm64" },
      deviceTokenHash: "hashed",
      lastSeenAt: Date.now(),
      status: "active",
      revokedAt: null,
      createdAt: 1,
      updatedAt: 2,
    };
    const command = {
      id: "cmd-1",
      deviceId: "device-1",
      ownerEmail: "alice@example.com",
      orgId: "org-1",
      kind: "create-run",
      params: { prompt: "Ship the relay smoke", title: "Relay smoke" },
      status: "completed",
      result: {
        run: {
          id: "run-1",
          runId: "run-1",
          title: "Relay smoke",
          status: "completed",
          updatedAt: "2026-05-16T00:00:00.000Z",
        },
      },
      platform: "mobile",
      externalThreadId: "mobile",
      attempts: 1,
      nextCheckAt: 1,
      claimedAt: 1,
      completedAt: 2,
      errorMessage: null,
      createdAt: 1,
      updatedAt: 2,
    };

    getSessionMock.mockResolvedValue({ email: "alice@example.com" });
    getOrgContextMock.mockResolvedValue({ orgId: "org-1" });
    createRemoteDeviceMock.mockResolvedValueOnce({
      device,
      token: "anr_raw-token",
    });
    listRemoteDevicesForOwnerMock.mockResolvedValue([device]);
    upsertRemotePushRegistrationMock.mockResolvedValueOnce({
      id: "push-1",
      ownerEmail: "alice@example.com",
      orgId: "org-1",
      provider: "expo",
      platform: "ios",
      clientDeviceId: null,
      label: "Alice iPhone",
      token: "ExpoPushToken[test]",
      tokenHash: "hashed-token",
      status: "active",
      lastSeenAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    enqueueRemoteCommandMock.mockResolvedValueOnce({
      ...command,
      status: "pending",
      result: null,
      completedAt: null,
    });
    authenticateRemoteDeviceTokenMock.mockResolvedValue(device);
    claimNextRemoteCommandMock.mockResolvedValueOnce({
      id: "cmd-1",
      deviceId: "device-1",
      kind: "create-run",
      status: "claimed",
      params: { prompt: "Ship the relay smoke" },
    });
    updateRemoteCommandResultMock.mockResolvedValueOnce(command);
    queueRemotePushNotificationsMock.mockResolvedValueOnce({ queued: 1 });
    insertRemoteRunEventsMock.mockResolvedValueOnce({ inserted: 1 });
    listRemoteCommandsForOwnerMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([command])
      .mockResolvedValueOnce([command]);
    listRemoteRunEventsMock.mockResolvedValueOnce([
      {
        deviceId: "device-1",
        remoteRunId: "run-1",
        seq: 1,
        event: { type: "status", text: "done" },
        createdAt: 1,
      },
    ]);
    revokeRemoteDeviceForOwnerMock.mockResolvedValueOnce({
      ...device,
      status: "inactive",
      revokedAt: 3,
      updatedAt: 3,
    });

    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({ adapters: [] })(nitroApp);

    await expect(
      dispatch(
        nitroApp,
        "/_agent-native/integrations/remote/register",
        "POST",
        {
          label: "Studio Mac",
          platform: "darwin",
          appVersion: "1.2.3",
          hostName: "studio",
          metadata: { arch: "arm64" },
        },
      ),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        token: "anr_raw-token",
        device: expect.not.objectContaining({ deviceTokenHash: "hashed" }),
      },
    });

    await expect(
      dispatch(nitroApp, "/_agent-native/integrations/remote/hosts", "GET"),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        hosts: [
          expect.objectContaining({
            id: "device-1",
            appVersion: "1.2.3",
            hostName: "studio",
          }),
        ],
      },
    });

    await expect(
      dispatch(
        nitroApp,
        "/_agent-native/integrations/remote/push/register",
        "POST",
        {
          provider: "expo",
          token: "ExpoPushToken[test]",
          platform: "ios",
          label: "Alice iPhone",
        },
      ),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        registration: expect.not.objectContaining({
          token: "ExpoPushToken[test]",
          tokenHash: "hashed-token",
        }),
      },
    });

    await expect(
      dispatch(nitroApp, "/_agent-native/integrations/remote/enqueue", "POST", {
        operation: "code-agent.run.create",
        payload: { prompt: "Ship the relay smoke", hostId: "device-1" },
        source: { platform: "mobile", externalThreadId: "mobile" },
      }),
    ).resolves.toMatchObject({
      status: 200,
      body: { commandId: "cmd-1", requestId: "cmd-1" },
    });

    await expect(
      dispatch(
        nitroApp,
        "/_agent-native/integrations/remote/poll?waitMs=0",
        "GET",
        undefined,
        { authorization: "Bearer anr_raw-token" },
      ),
    ).resolves.toMatchObject({
      status: 200,
      body: { command: expect.objectContaining({ id: "cmd-1" }) },
    });

    await expect(
      dispatch(
        nitroApp,
        "/_agent-native/integrations/remote/result",
        "POST",
        {
          commandId: "cmd-1",
          status: "completed",
          result: { run: { id: "run-1", status: "completed" } },
        },
        { authorization: "Bearer anr_raw-token" },
      ),
    ).resolves.toMatchObject({
      status: 200,
      body: { command: expect.objectContaining({ id: "cmd-1" }) },
    });

    await expect(
      dispatch(
        nitroApp,
        "/_agent-native/integrations/remote/run-events",
        "POST",
        {
          remoteRunId: "run-1",
          events: [{ seq: 1, event: { type: "status", text: "done" } }],
        },
        { authorization: "Bearer anr_raw-token" },
      ),
    ).resolves.toMatchObject({
      status: 200,
      body: { ok: true, inserted: 1 },
    });

    await expect(
      dispatch(nitroApp, "/_agent-native/integrations/remote/runs", "GET"),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        runs: [expect.objectContaining({ id: "run-1", hostId: "device-1" })],
      },
    });

    await expect(
      dispatch(
        nitroApp,
        "/_agent-native/integrations/remote/runs/run-1/transcript",
        "GET",
      ),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        run: expect.objectContaining({ id: "run-1" }),
        events: [{ type: "status", text: "done" }],
      },
    });

    await expect(
      dispatch(
        nitroApp,
        "/_agent-native/integrations/remote/devices/device-1/revoke",
        "POST",
      ),
    ).resolves.toMatchObject({
      status: 200,
      body: { ok: true },
    });
  });

  it("queues push notifications when an authenticated device completes a command", async () => {
    authenticateRemoteDeviceTokenMock.mockResolvedValueOnce({
      id: "device-1",
      ownerEmail: "alice@example.com",
      orgId: "org-1",
      label: "Studio Mac",
      platform: null,
      appVersion: null,
      hostName: null,
      metadata: null,
      deviceTokenHash: "hashed",
      lastSeenAt: 1,
      status: "active",
      revokedAt: null,
      createdAt: 1,
      updatedAt: 1,
    });
    updateRemoteCommandResultMock.mockResolvedValueOnce({
      id: "cmd-1",
      deviceId: "device-1",
      ownerEmail: "alice@example.com",
      orgId: "org-1",
      kind: "append-followup",
      params: {},
      status: "completed",
      result: { message: "done" },
      platform: "mobile",
      externalThreadId: "thread-1",
      attempts: 1,
      nextCheckAt: 1,
      claimedAt: 1,
      completedAt: 2,
      errorMessage: null,
      createdAt: 1,
      updatedAt: 2,
    });
    queueRemotePushNotificationsMock.mockResolvedValueOnce({ queued: 1 });
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({ adapters: [] })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/integrations/remote/result",
      "POST",
      { commandId: "cmd-1", status: "completed", result: { message: "done" } },
      { authorization: "Bearer anr_raw-token" },
    );

    expect(result.status).toBe(200);
    expect(queueRemotePushNotificationsMock).toHaveBeenCalledWith({
      ownerEmail: "alice@example.com",
      orgId: "org-1",
      payload: expect.objectContaining({
        title: "Remote run completed",
        commandId: "cmd-1",
        kind: "append-followup",
        status: "completed",
      }),
    });
  });

  it("accepts idempotent run events from the authenticated device", async () => {
    authenticateRemoteDeviceTokenMock.mockResolvedValueOnce({
      id: "device-1",
      ownerEmail: "alice@example.com",
      orgId: null,
      label: "Studio Mac",
      deviceTokenHash: "hashed",
      lastSeenAt: 1,
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    insertRemoteRunEventsMock.mockResolvedValueOnce({ inserted: 1 });
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({ adapters: [] })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/integrations/remote/run-events",
      "POST",
      {
        remoteRunId: "run-1",
        events: [{ seq: 1, event: { type: "text", text: "hi" } }],
      },
      { authorization: "Bearer anr_raw-token" },
    );

    expect(result.status).toBe(200);
    expect(insertRemoteRunEventsMock).toHaveBeenCalledWith({
      deviceId: "device-1",
      remoteRunId: "run-1",
      events: [{ seq: 1, event: { type: "text", text: "hi" } }],
    });
    expect(result.body).toEqual({ ok: true, inserted: 1 });
  });
});
