import { expect, it, vi } from "vitest";

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

it("reads and clears consent requests from the design capability session", async () => {
  const request = {
    designId: "design/public",
    connectionId: "connection-1",
    rootPath: "/workspace",
    files: ["index.html"],
    requestedAt: "2026-09-30T20:00:00.000Z",
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
