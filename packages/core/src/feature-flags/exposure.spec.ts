import { describe, expect, it, vi } from "vitest";

const track = vi.hoisted(() => vi.fn());
const evaluateFeatureFlagDecision = vi.hoisted(() => vi.fn());

vi.mock("../tracking/registry.js", () => ({ track }));
vi.mock("./store.js", () => ({ evaluateFeatureFlagDecision }));

describe("explicit feature flag exposure", () => {
  it("emits the exact decision metadata without making evaluation a side effect", async () => {
    evaluateFeatureFlagDecision.mockResolvedValue({
      value: true,
      reason: "percentage-treatment",
      bucket: 24,
      rolloutEpoch: "epoch-1",
      rolloutPercentage: 50,
      userKey: "alice@example.com",
    });
    const { exposeFeatureFlag } = await import("./exposure.js");
    await exposeFeatureFlag(
      "new-editor",
      { userEmail: "alice@example.com" },
      "content",
    );
    expect(track).toHaveBeenCalledWith(
      "$feature_flag_exposure",
      expect.objectContaining({
        flag_key: "new-editor",
        reason: "percentage-treatment",
        bucket: 24,
        rollout_epoch: "epoch-1",
        rollout_percentage: 50,
        user_key: "alice@example.com",
      }),
      { userId: "alice@example.com" },
    );
  });
});
