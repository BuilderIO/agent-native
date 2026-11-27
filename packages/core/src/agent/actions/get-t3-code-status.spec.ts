import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionRunContext } from "../../action.js";

const mockAssertLabEnabled = vi.fn();
const mockGetStatus = vi.fn();

vi.mock("../../labs/guard.js", () => ({
  assertLabEnabled: (...args: unknown[]) => mockAssertLabEnabled(...args),
}));

vi.mock("../../mcp-client/t3-code.js", () => ({
  getT3CodeStatus: (...args: unknown[]) => mockGetStatus(...args),
}));

import action from "./get-t3-code-status.js";

const ctx: ActionRunContext = {
  userEmail: "alice@example.test",
  caller: "http",
};

describe("get-t3-code-status", () => {
  beforeEach(() => {
    mockAssertLabEnabled.mockReset().mockResolvedValue(undefined);
    mockGetStatus.mockReset().mockResolvedValue({
      state: "connected",
      computer: "Studio",
      access: "operate",
      agents: [],
    });
  });

  it("is a read the app makes, off MCP", () => {
    expect(action.http).toEqual({ method: "GET" });
    expect(action.mcpTool).toBe(false);
  });

  it("returns the signed-in person's own connection", async () => {
    await expect(action.run({}, ctx)).resolves.toEqual({
      state: "connected",
      computer: "Studio",
      access: "operate",
      agents: [],
    });
    expect(mockGetStatus).toHaveBeenCalledWith("alice@example.test");
    expect(mockAssertLabEnabled.mock.calls[0]?.[0]).toMatchObject({
      key: "t3-code-agents",
    });
  });

  it("refuses a caller who isn't signed in, or whose Lab is off", async () => {
    await expect(action.run({}, { caller: "http" })).rejects.toThrow(
      "Not authenticated.",
    );
    mockAssertLabEnabled.mockRejectedValueOnce(new Error("Lab off"));
    await expect(action.run({}, ctx)).rejects.toThrow("Lab off");
    expect(mockGetStatus).not.toHaveBeenCalled();
  });
});
