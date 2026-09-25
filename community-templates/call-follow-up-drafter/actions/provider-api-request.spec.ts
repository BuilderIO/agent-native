import { beforeEach, describe, expect, it, vi } from "vitest";

const executeRequest = vi.fn();

vi.mock("@agent-native/core/provider-api", () => ({
  createProviderApiRuntime: () => ({ executeRequest }),
}));

const { default: action, requiresProviderApiApproval } =
  await import("./provider-api-request");

describe("provider-api-request", () => {
  beforeEach(() => {
    executeRequest.mockReset();
  });

  it("routes Slack reads through the shared provider runtime", async () => {
    executeRequest.mockResolvedValue({ ok: true, team: "Example" });

    await expect(
      action.run({ provider: "slack", method: "GET", path: "/auth.test" }),
    ).resolves.toEqual({ ok: true, team: "Example" });
    expect(executeRequest).toHaveBeenCalledWith({
      provider: "slack",
      method: "GET",
      path: "/auth.test",
    });
  });

  it("requires approval for provider writes", () => {
    expect(requiresProviderApiApproval({ method: "GET" })).toBe(false);
    expect(requiresProviderApiApproval({ method: "HEAD" })).toBe(false);
    expect(requiresProviderApiApproval({ method: "POST" })).toBe(true);
  });
});
