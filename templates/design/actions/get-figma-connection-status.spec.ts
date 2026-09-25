import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveSecret: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  resolveSecret: mocks.resolveSecret,
}));

import action from "./get-figma-connection-status.js";

describe("get-figma-connection-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports request-scoped availability without returning the credential", async () => {
    const exampleToken = "<FIGMA_ACCESS_TOKEN>";
    mocks.resolveSecret.mockResolvedValue(exampleToken);

    const result = await action.run({});

    expect(mocks.resolveSecret).toHaveBeenCalledWith("FIGMA_ACCESS_TOKEN");
    expect(result).toEqual({ available: true });
    expect(JSON.stringify(result)).not.toContain(exampleToken);
  });

  it("reports unavailable when no usable request-scoped credential exists", async () => {
    mocks.resolveSecret.mockResolvedValue(null);

    await expect(action.run({})).resolves.toEqual({ available: false });
  });

  it("stays hidden from the model while remaining a read-only UI action", () => {
    expect(action.agentTool).toBe(false);
    expect(action.http).toEqual({ method: "GET" });
    expect(action.readOnly).toBe(true);
  });
});
