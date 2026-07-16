import { beforeEach, describe, expect, it, vi } from "vitest";

const trackEvent = vi.hoisted(() => vi.fn());
vi.mock("../analytics.js", () => ({ trackEvent }));

describe("trackFeatureFlagExposure", () => {
  beforeEach(() => {
    trackEvent.mockReset();
    vi.resetModules();
  });

  it("preserves the default app, uses canonical userId, and dedupes per user flag epoch", async () => {
    const { trackFeatureFlagExposure } = await import("./exposure.js");
    const alice = {
      value: true as const,
      reason: "percentage-treatment" as const,
      bucket: 12,
      rolloutEpoch: "epoch-1",
      rolloutPercentage: 50,
      userKey: "alice@example.com",
    };
    trackFeatureFlagExposure("new-editor", alice);
    trackFeatureFlagExposure("new-editor", alice);
    trackFeatureFlagExposure("new-editor", {
      ...alice,
      userKey: "bob@example.com",
    });
    expect(trackEvent).toHaveBeenCalledTimes(2);
    expect(trackEvent).toHaveBeenNthCalledWith(
      1,
      "$feature_flag_exposure",
      expect.objectContaining({
        userId: "alice@example.com",
        user_key: "alice@example.com",
        flag_key: "new-editor",
        rollout_epoch: "epoch-1",
      }),
    );
    expect(trackEvent.mock.calls[0]?.[1]).not.toHaveProperty("app");
    expect(trackEvent).toHaveBeenNthCalledWith(
      2,
      "$feature_flag_exposure",
      expect.objectContaining({
        userId: "bob@example.com",
        user_key: "bob@example.com",
      }),
    );
  });
});
