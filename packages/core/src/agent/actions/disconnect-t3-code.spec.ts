import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionRunContext } from "../../action.js";

const mockAssertLabEnabled = vi.fn();
const mockDisconnect = vi.fn();

vi.mock("../../labs/guard.js", () => ({
  assertLabEnabled: (...args: unknown[]) => mockAssertLabEnabled(...args),
}));

vi.mock("../../mcp-client/t3-code.js", () => ({
  disconnectT3Code: (...args: unknown[]) => mockDisconnect(...args),
}));

import action from "./disconnect-t3-code.js";

const ctx: ActionRunContext = {
  userEmail: "alice@example.test",
  caller: "http",
};

describe("disconnect-t3-code", () => {
  beforeEach(() => {
    mockAssertLabEnabled.mockReset().mockResolvedValue(undefined);
    mockDisconnect.mockReset().mockResolvedValue({ disconnected: true });
  });

  it("runs only from the signed-in app, off MCP", () => {
    expect(action.requiresSignedInBrowser).toBe(true);
    expect(action.mcpTool).toBe(false);
  });

  it("signs the person out of their own T3", async () => {
    await expect(action.run({}, ctx)).resolves.toEqual({ disconnected: true });
    expect(mockDisconnect).toHaveBeenCalledWith("alice@example.test");
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
    expect(mockDisconnect).not.toHaveBeenCalled();
  });
});
