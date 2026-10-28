import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectChain = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  selectChain.from.mockReturnValue(selectChain);
  selectChain.where.mockReturnValue(selectChain);
  const db = { select: vi.fn(() => selectChain) };
  return {
    appStateCompareAndSet: vi.fn(),
    appStateGet: vi.fn(),
    appStatePut: vi.fn(),
    assertAccess: vi.fn(),
    db,
    getDb: vi.fn(() => db),
    readAppStateForCurrentTab: vi.fn(),
    resolveLocalhostConnectionScope: vi.fn(),
    selectChain,
  };
});

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
}));
vi.mock("@agent-native/core/application-state", () => ({
  appStateCompareAndSet: mocks.appStateCompareAndSet,
  appStateGet: mocks.appStateGet,
  appStatePut: mocks.appStatePut,
  readAppStateForCurrentTab: mocks.readAppStateForCurrentTab,
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));
vi.mock("../server/db/index.js", () => ({
  getDb: mocks.getDb,
  schema: {
    designLocalhostConnections: {
      bridgeToken: "designLocalhostConnections.bridgeToken",
      id: "designLocalhostConnections.id",
      orgId: "designLocalhostConnections.orgId",
      ownerEmail: "designLocalhostConnections.ownerEmail",
      rootPath: "designLocalhostConnections.rootPath",
    },
    designLocalhostWriteGrants: {
      connectionId: "designLocalhostWriteGrants.connectionId",
      designId: "designLocalhostWriteGrants.designId",
      orgId: "designLocalhostWriteGrants.orgId",
      ownerEmail: "designLocalhostWriteGrants.ownerEmail",
      grantedUntil: "designLocalhostWriteGrants.grantedUntil",
    },
  },
}));
vi.mock("../server/lib/localhost-connection.js", () => ({
  resolveLocalhostConnectionScope: mocks.resolveLocalhostConnectionScope,
}));

import {
  getRequestAuthCapability,
  getRequestUserEmail,
  runWithRequestContext,
} from "@agent-native/core/server/request-context";

import clearAction from "./clear-localhost-write-consent-request.js";
import getAction from "./get-localhost-write-consent-request.js";
import { localhostConsentRequestStateAddress } from "./localhost-consent-request-state.js";
import requestAction from "./request-localhost-write-consent.js";

beforeEach(() => {
  vi.clearAllMocks();
});

it("reads and clears consent requests from the design capability session", async () => {
  const request = {
    designId: "design/public",
    connectionId: "connection-1",
    rootPath: "/workspace",
    files: ["index.html"],
    requestedAt: new Date().toISOString(),
  };
  const key = "design-localhost-write-consent-request:design/public";
  const sessionId = "capability:capability:visual-edit:design:design%2Fpublic";
  mocks.assertAccess.mockResolvedValue({ role: "editor" });
  mocks.appStateGet.mockResolvedValue(request);
  mocks.appStateCompareAndSet.mockResolvedValue(true);

  await expect(getAction.run({ designId: request.designId })).resolves.toEqual({
    request,
  });
  await expect(
    clearAction.run({
      designId: request.designId,
      requestedAt: request.requestedAt,
    }),
  ).resolves.toEqual({ cleared: true });

  expect(mocks.assertAccess).toHaveBeenNthCalledWith(
    1,
    "design",
    request.designId,
    "editor",
  );
  expect(mocks.assertAccess).toHaveBeenNthCalledWith(
    2,
    "design",
    request.designId,
    "editor",
  );
  expect(mocks.appStateGet).toHaveBeenNthCalledWith(1, sessionId, key);
  expect(mocks.appStateGet).toHaveBeenNthCalledWith(2, sessionId, key);
  expect(mocks.appStateCompareAndSet).toHaveBeenCalledWith(
    sessionId,
    key,
    request,
    null,
    { requestSource: "agent" },
  );
});

it("writes requests to the design session for identified and capability-only callers", async () => {
  const designId = "design/public";
  const connectionId = "connection-1";
  const ownerEmail = "owner@example.test";
  const capability = "capability:visual-edit:design:design%2Fpublic";
  const { key, sessionId } = localhostConsentRequestStateAddress(designId);
  const callers = [
    { userEmail: ownerEmail, authCapability: capability },
    { authCapability: capability },
  ];

  mocks.assertAccess.mockResolvedValue({ role: "editor" });
  mocks.resolveLocalhostConnectionScope.mockResolvedValue({
    ownerEmail,
    orgId: "org-1",
  });
  mocks.readAppStateForCurrentTab.mockResolvedValue(null);

  for (const caller of callers) {
    mocks.selectChain.limit
      .mockReset()
      .mockResolvedValueOnce([
        { rootPath: "/workspace", bridgeToken: "fake-bridge-token" },
      ])
      .mockResolvedValueOnce([]);
    mocks.appStatePut.mockClear();

    await runWithRequestContext(caller, async () => {
      expect(getRequestUserEmail()).toBe(caller.userEmail);
      expect(getRequestAuthCapability()).toBe(capability);
      await requestAction.run({
        designId,
        connectionId,
        files: ["index.html"],
      });
    });

    expect(mocks.appStatePut).toHaveBeenCalledTimes(1);
    expect(mocks.appStatePut).toHaveBeenCalledWith(
      sessionId,
      key,
      expect.objectContaining({
        designId,
        connectionId,
        rootPath: "/workspace",
        files: ["index.html"],
      }),
      { requestSource: "agent" },
    );
  }
});

it("stops offering a consent request once it is older than the TTL", async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-10-24T08:00:00.000Z"));
    mocks.assertAccess.mockResolvedValue({ role: "editor" });
    const request = {
      designId: "design-1",
      connectionId: "connection-1",
      rootPath: "/workspace",
      files: ["index.html"],
      requestedAt: "2026-10-24T07:31:00.000Z",
      requestId: "request-1",
    };
    mocks.appStateGet.mockResolvedValue(request);
    await expect(getAction.run({ designId: "design-1" })).resolves.toEqual({
      request,
    });

    mocks.appStateGet.mockResolvedValue({
      ...request,
      requestedAt: "2026-10-24T07:29:59.000Z",
    });
    await expect(getAction.run({ designId: "design-1" })).resolves.toEqual({
      request: null,
      expired: true,
    });
    expect(mocks.appStatePut).not.toHaveBeenCalled();
    expect(mocks.appStateCompareAndSet).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("fails loudly on a stored request with an unreadable time", async () => {
  mocks.assertAccess.mockResolvedValue({ role: "editor" });
  mocks.appStateGet.mockResolvedValue({
    designId: "design-1",
    connectionId: "connection-1",
    rootPath: "/workspace",
    files: [],
    requestedAt: "not-a-time",
    requestId: "request-1",
  });
  await expect(getAction.run({ designId: "design-1" })).rejects.toThrow(
    /requestedAt/,
  );
  expect(mocks.appStateCompareAndSet).not.toHaveBeenCalled();
});

it("still reads requests queued before request IDs existed", async () => {
  const legacy = {
    designId: "design-1",
    connectionId: "connection-1",
    rootPath: "/workspace",
    files: [],
    requestedAt: new Date().toISOString(),
  };
  mocks.assertAccess.mockResolvedValue({ role: "editor" });
  mocks.appStateGet.mockResolvedValue(legacy);
  await expect(getAction.run({ designId: "design-1" })).resolves.toEqual({
    request: legacy,
  });
});

it("skips an unreadable request queued before request IDs existed", async () => {
  const legacy = {
    designId: "design-1",
    connectionId: "connection-1",
    rootPath: "/workspace",
    files: [],
    requestedAt: new Date().toISOString(),
  };
  mocks.assertAccess.mockResolvedValue({ role: "editor" });
  for (const stored of [
    { ...legacy, requestedAt: "not-a-time" },
    { ...legacy, files: "index.html" },
    { ...legacy, designId: "design-2" },
    "not-a-request",
  ]) {
    mocks.appStateGet.mockResolvedValue(stored);
    await expect(getAction.run({ designId: "design-1" })).resolves.toEqual({
      request: null,
    });
  }
  expect(mocks.appStatePut).not.toHaveBeenCalled();
  expect(mocks.appStateCompareAndSet).not.toHaveBeenCalled();
});

it("holds any record with a request ID field to the current shape", async () => {
  const current = {
    designId: "design-1",
    connectionId: "connection-1",
    rootPath: "/workspace",
    files: [],
    requestedAt: new Date().toISOString(),
    requestId: "request-1",
  };
  mocks.assertAccess.mockResolvedValue({ role: "editor" });
  for (const requestId of ["", null, 42]) {
    mocks.appStateGet.mockResolvedValue({ ...current, requestId });
    await expect(getAction.run({ designId: "design-1" })).rejects.toThrow(
      /requestId/,
    );
  }
  mocks.appStateGet.mockResolvedValue({ ...current, designId: "design-2" });
  await expect(getAction.run({ designId: "design-1" })).rejects.toThrow(
    /designId/,
  );
});

it("keeps a newer request that shares the cleared request's timestamp", async () => {
  const requestedAt = "2026-10-24T08:00:00.000Z";
  mocks.assertAccess.mockResolvedValue({ role: "editor" });
  mocks.appStateCompareAndSet.mockReset().mockResolvedValue(true);
  mocks.appStateGet.mockResolvedValue({
    designId: "design-1",
    connectionId: "connection-1",
    rootPath: "/workspace",
    files: [],
    requestedAt,
    requestId: "newer-request",
  });

  await expect(
    clearAction.run({
      designId: "design-1",
      requestedAt,
      requestId: "older-request",
    }),
  ).resolves.toEqual({ cleared: false });
  expect(mocks.appStateCompareAndSet).not.toHaveBeenCalled();

  await expect(
    clearAction.run({
      designId: "design-1",
      requestedAt,
      requestId: "newer-request",
    }),
  ).resolves.toEqual({ cleared: true });
  expect(mocks.appStateCompareAndSet).toHaveBeenCalledTimes(1);
});

it("queues an ID'd request for sign-in even while a grant is valid", async () => {
  const designId = "design-1";
  const connectionId = "connection-1";
  const validGrant = [
    { grantedUntil: new Date(Date.now() + 60_000).toISOString() },
  ];
  mocks.assertAccess.mockResolvedValue({ role: "editor" });
  mocks.resolveLocalhostConnectionScope.mockResolvedValue({
    ownerEmail: "owner@example.test",
    orgId: null,
  });
  mocks.readAppStateForCurrentTab.mockResolvedValue(null);
  const connection = [
    { rootPath: "/workspace", bridgeToken: "fake-bridge-token" },
  ];

  mocks.appStatePut.mockClear();
  mocks.selectChain.limit
    .mockReset()
    .mockResolvedValueOnce(connection)
    .mockResolvedValueOnce(validGrant);
  await expect(
    requestAction.run({ designId, connectionId, files: ["index.html"] }),
  ).resolves.toMatchObject({ alreadyGranted: true });
  expect(mocks.appStatePut).not.toHaveBeenCalled();

  mocks.selectChain.limit
    .mockReset()
    .mockResolvedValueOnce(connection)
    .mockResolvedValueOnce(validGrant);
  const queued = await requestAction.run({
    designId,
    connectionId,
    files: ["index.html"],
    resumeAfterSignIn: true,
  });
  expect(queued).toMatchObject({
    requestId: expect.any(String),
    requestedAt: expect.any(String),
  });
  expect(queued).not.toHaveProperty("alreadyGranted");
  expect(mocks.appStatePut).toHaveBeenCalledWith(
    expect.any(String),
    expect.any(String),
    {
      designId,
      connectionId,
      rootPath: "/workspace",
      files: ["index.html"],
      requestedAt: (queued as { requestedAt: string }).requestedAt,
      requestId: (queued as { requestId: string }).requestId,
    },
    { requestSource: "agent" },
  );
});
