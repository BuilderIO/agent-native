import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: {
    authUserId: "auth-user-1",
    userEmail: "person@example.test",
    orgId: "org-1",
  } as Record<string, string | null> | null,
  isEnabled: vi.fn(),
  recordExposure: vi.fn(),
}));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  defineAction: (action: unknown) => action,
}));
vi.mock("@agent-native/core/feature-flags", () => ({
  isFeatureFlagEnabled: (...args: unknown[]) => mocks.isEnabled(...args),
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestContext: () => mocks.context,
  recordFirstRunBuilderCreditsV2Exposure: (...args: unknown[]) =>
    mocks.recordExposure(...args),
}));

import action from "./record-first-run-builder-credits-v2-exposure.js";

describe("record-first-run-builder-credits-v2-exposure", () => {
  beforeEach(() => {
    mocks.context = {
      authUserId: "auth-user-1",
      userEmail: "person@example.test",
      orgId: "org-1",
    };
    mocks.isEnabled.mockReset();
    mocks.recordExposure.mockReset();
  });

  it("does not persist an assignment while the Clips flag is off", async () => {
    mocks.isEnabled.mockResolvedValue(false);

    await expect(action.run({})).resolves.toEqual({ assignment: null });

    expect(mocks.isEnabled).toHaveBeenCalledWith(
      expect.objectContaining({ key: "clips-first-run-credits-v2" }),
      {
        userEmail: "person@example.test",
        userKey: "auth-user-1",
        orgId: "org-1",
      },
    );
    expect(mocks.recordExposure).not.toHaveBeenCalled();
  });

  it("persists only an authenticated user's assignment after exposure", async () => {
    mocks.isEnabled.mockResolvedValue(true);
    mocks.recordExposure.mockResolvedValue({
      experiment_id: "first_run_builder_credits_v2",
      experiment_variant: "credits",
    });

    await expect(action.run({})).resolves.toEqual({
      assignment: {
        experiment_id: "first_run_builder_credits_v2",
        experiment_variant: "credits",
      },
    });

    expect(mocks.recordExposure).toHaveBeenCalledWith({ flagEnabled: true });
  });

  it("does not assign when the request has no authenticated user", async () => {
    mocks.context = null;

    await expect(action.run({})).resolves.toEqual({ assignment: null });

    expect(mocks.isEnabled).not.toHaveBeenCalled();
    expect(mocks.recordExposure).not.toHaveBeenCalled();
  });
});
