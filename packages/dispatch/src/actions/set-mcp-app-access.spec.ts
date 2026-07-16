import { createActionInvocationDescriptor } from "@agent-native/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  discoverAgents: vi.fn(),
  setAccess: vi.fn(),
  recordAudit: vi.fn(),
  listAccess: vi.fn(),
}));

vi.mock("@agent-native/core/server/agent-discovery", () => ({
  discoverAgents: mocks.discoverAgents,
}));

vi.mock("../server/lib/mcp-access-store.js", () => ({
  setDispatchMcpAppAccessSettings: mocks.setAccess,
}));

vi.mock("../server/lib/dispatch-store.js", () => ({
  recordAudit: mocks.recordAudit,
}));

vi.mock("./list-mcp-app-access.js", () => ({
  default: { run: mocks.listAccess },
}));

import setMcpAppAccess from "./set-mcp-app-access.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.discoverAgents.mockResolvedValue([
    { id: "analytics" },
    { id: "slides" },
  ]);
  mocks.setAccess.mockResolvedValue(undefined);
  mocks.recordAudit.mockResolvedValue(undefined);
  mocks.listAccess.mockResolvedValue({ mode: "selected-apps" });
});

describe("set-mcp-app-access", () => {
  it("accepts Dispatch itself in selected-app mode", async () => {
    await setMcpAppAccess.run({
      mode: "selected-apps",
      selectedAppIds: ["Dispatch", "slides"],
    });

    expect(mocks.setAccess).toHaveBeenCalledWith({
      mode: "selected-apps",
      selectedAppIds: ["dispatch", "slides"],
    });
  });

  it("allows an owner or admin to revoke every app grant", async () => {
    await setMcpAppAccess.run({
      mode: "selected-apps",
      selectedAppIds: [],
    });

    expect(mocks.setAccess).toHaveBeenCalledWith({
      mode: "selected-apps",
      selectedAppIds: [],
    });
  });

  it("rejects unknown app ids before changing access", async () => {
    await expect(
      setMcpAppAccess.run({
        mode: "selected-apps",
        selectedAppIds: ["unknown"],
      }),
    ).rejects.toThrow(/Unknown app/);
    expect(mocks.setAccess).not.toHaveBeenCalled();
  });

  it("inherits invocation and resolver context for the nested list action", async () => {
    const invocation = createActionInvocationDescriptor("frontend", [
      "dispatch:read",
    ]);
    const resolve = vi.fn().mockResolvedValue({
      status: "executed",
      result: { mode: "all-apps", routed: true },
      placement: "trusted_endpoint",
    });
    const result = await setMcpAppAccess.run(
      { mode: "all-apps", selectedAppIds: [] },
      {
        caller: "frontend",
        actionName: "set-mcp-app-access",
        invocation,
        executionResolver: {
          placements: ["trusted_endpoint"],
          resolve,
        },
      },
    );

    expect(result).toEqual({ mode: "all-apps", routed: true });
    expect(mocks.listAccess).not.toHaveBeenCalled();
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        actionName: "list-mcp-app-access",
        invocation,
        context: expect.objectContaining({
          actionName: "list-mcp-app-access",
          invocation,
        }),
      }),
    );
  });
});
