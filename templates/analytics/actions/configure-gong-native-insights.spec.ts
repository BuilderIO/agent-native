import { beforeEach, describe, expect, it, vi } from "vitest";

const writeGongNativeInsightsPolicy = vi.hoisted(() => vi.fn());

vi.mock("../server/lib/gong-native-policy", () => ({
  writeGongNativeInsightsPolicy,
}));

const { default: action } = await import("./configure-gong-native-insights");

describe("configure-gong-native-insights", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists the scope policy without spending a Gong request", async () => {
    writeGongNativeInsightsPolicy.mockResolvedValue({
      enabled: true,
      configured: true,
      scope: "workspace",
      updatedAt: "2026-07-17T12:00:00.000Z",
    });

    await expect(action.run({ enabled: true })).resolves.toMatchObject({
      enabled: true,
      configured: true,
      scope: "workspace",
      creditRequests: 0,
    });
    expect(writeGongNativeInsightsPolicy).toHaveBeenCalledWith(true);
  });
});
