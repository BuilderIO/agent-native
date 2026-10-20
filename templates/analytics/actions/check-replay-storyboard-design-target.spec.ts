import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  resolveReplayStoryboardDesignTarget: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("../server/lib/replay-storyboard-design-target.js", () => ({
  resolveReplayStoryboardDesignTarget:
    mocks.resolveReplayStoryboardDesignTarget,
}));

import action from "./check-replay-storyboard-design-target.js";

describe("check-replay-storyboard-design-target", () => {
  beforeEach(() => {
    mocks.getRequestUserEmail.mockReset();
    mocks.resolveReplayStoryboardDesignTarget.mockReset();
    mocks.getRequestUserEmail.mockReturnValue("signed-in-user@example.test");
    mocks.resolveReplayStoryboardDesignTarget.mockResolvedValue({
      code: "ready",
      targetClass: "beta_design",
      url: "https://private.target.example",
    });
  });

  it("exposes only fixed readiness, failure, and target-class codes", async () => {
    await expect(action.run({} as never)).resolves.toEqual({
      code: "ready",
      targetClass: "beta_design",
    });
    expect(action.http).toEqual({ method: "GET" });
    expect(action.requiresAuth).toBe(true);
    expect(action.readOnly).toBe(true);
    expect(action.agentTool).toBe(false);
    expect(action.mcpTool).toBe(false);
    expect(action.persistInBrowser).toBe(false);

    mocks.resolveReplayStoryboardDesignTarget.mockResolvedValue({
      code: "notready",
      failureCode: "target_mismatch",
      targetClass: "configured_design",
      url: "https://private.target.example",
    });
    await expect(action.run({} as never)).resolves.toEqual({
      code: "notready",
      failureCode: "target_mismatch",
      targetClass: "configured_design",
    });
  });
});
