import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isAgentKitFigmaSourceAvailable: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  isAgentKitFigmaSourceAvailable: mocks.isAgentKitFigmaSourceAvailable,
}));

import action from "./get-figma-connection-status.js";

describe("get-figma-connection-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports request-scoped availability without returning the credential", async () => {
    mocks.isAgentKitFigmaSourceAvailable.mockResolvedValue(true);

    const result = await action.run(
      {},
      { appId: "design", userEmail: "member@example.test", orgId: "org-1" },
    );

    expect(mocks.isAgentKitFigmaSourceAvailable).toHaveBeenCalledWith({
      userEmail: "member@example.test",
      orgId: "org-1",
    });
    expect(result).toEqual({ available: true });
    expect(JSON.stringify(result)).not.toContain("FIGMA_ACCESS_TOKEN");
  });

  it("reports unavailable when no usable request-scoped credential exists", async () => {
    mocks.isAgentKitFigmaSourceAvailable.mockResolvedValue(false);

    await expect(
      action.run({}, { appId: "design", userEmail: "member@example.test" }),
    ).resolves.toEqual({ available: false });
  });

  it("stays hidden from the model while remaining a read-only UI action", () => {
    expect(action.agentTool).toBe(false);
    expect(action.http).toEqual({ method: "GET" });
    expect(action.readOnly).toBe(true);
  });
});
