import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listForApp: vi.fn(),
  resolveForApp: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  fail: (message: string, details?: Record<string, unknown>) => {
    throw Object.assign(new Error(message), details);
  },
}));
vi.mock("@agent-native/core/workspace-connections", () => ({
  listWorkspaceConnectionsForApp: mocks.listForApp,
  resolveWorkspaceConnectionForApp: mocks.resolveForApp,
}));

import { resolveSigmaConnectionSelection } from "./sigma-connections.js";

const connection = {
  id: "connection_1",
  label: "Finance Sigma",
  status: "connected",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listForApp.mockResolvedValue([connection]);
  mocks.resolveForApp.mockResolvedValue({
    available: true,
    connection,
  });
});

describe("resolveSigmaConnectionSelection", () => {
  it("rechecks the single connection against the current user before auto-selecting", async () => {
    await expect(resolveSigmaConnectionSelection()).resolves.toMatchObject({
      selected: connection,
      requiresSelection: false,
    });
    expect(mocks.resolveForApp).toHaveBeenCalledWith({
      appId: "analytics",
      provider: "sigma",
      includeDisabled: true,
      connectionId: "connection_1",
      requireConnected: true,
    });
  });

  it("requires a choice when multiple user-accessible connections are available", async () => {
    mocks.listForApp.mockResolvedValue([
      connection,
      { id: "connection_2", label: "Operations Sigma", status: "connected" },
    ]);

    await expect(resolveSigmaConnectionSelection()).resolves.toMatchObject({
      selected: null,
      requiresSelection: true,
    });
    expect(mocks.resolveForApp).not.toHaveBeenCalled();
  });

  it("rejects a requested connection that the current user cannot resolve", async () => {
    mocks.resolveForApp.mockResolvedValue({
      available: false,
      connection: null,
    });

    await expect(
      resolveSigmaConnectionSelection("connection_1"),
    ).rejects.toMatchObject({
      errorCode: "sigma_connection_unavailable",
      statusCode: 403,
    });
  });
});
