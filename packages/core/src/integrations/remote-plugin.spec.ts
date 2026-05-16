import { afterEach, describe, expect, it, vi } from "vitest";
import { createIntegrationsPlugin } from "./plugin.js";

const getSessionMock = vi.hoisted(() => vi.fn());
const getOrgContextMock = vi.hoisted(() => vi.fn());
const createRemoteDeviceMock = vi.hoisted(() => vi.fn());
const getRemoteDeviceForOwnerMock = vi.hoisted(() => vi.fn());
const authenticateRemoteDeviceTokenMock = vi.hoisted(() => vi.fn());
const claimNextRemoteCommandMock = vi.hoisted(() => vi.fn());
const enqueueRemoteCommandMock = vi.hoisted(() => vi.fn());
const updateRemoteCommandResultMock = vi.hoisted(() => vi.fn());
const insertRemoteRunEventsMock = vi.hoisted(() => vi.fn());

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
  getRemoteDeviceForOwner: getRemoteDeviceForOwnerMock,
  toPublicRemoteDevice: (device: any) => {
    const { deviceTokenHash, ...publicDevice } = device;
    return publicDevice;
  },
}));

vi.mock("./remote-commands-store.js", () => ({
  claimNextRemoteCommand: claimNextRemoteCommandMock,
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
  updateRemoteCommandResult: updateRemoteCommandResultMock,
}));

vi.mock("./remote-run-events-store.js", () => ({
  insertRemoteRunEvents: insertRemoteRunEventsMock,
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
        deviceTokenHash: "hashed",
        lastSeenAt: 1,
        status: "active",
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
