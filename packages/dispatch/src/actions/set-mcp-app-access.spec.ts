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

  it("only routes to built-ins that are part of the workspace", async () => {
    // discoverAgents already omits built-ins the builder or admin turned off.
    mocks.discoverAgents.mockResolvedValue([{ id: "crm" }]);

    await expect(
      setMcpAppAccess.run({
        mode: "selected-apps",
        selectedAppIds: ["mail"],
      }),
    ).rejects.toThrow(/Unknown app/);
    await setMcpAppAccess.run({
      mode: "selected-apps",
      selectedAppIds: ["crm"],
    });
    expect(mocks.setAccess).toHaveBeenCalledWith({
      mode: "selected-apps",
      selectedAppIds: ["crm"],
    });
  });
});
