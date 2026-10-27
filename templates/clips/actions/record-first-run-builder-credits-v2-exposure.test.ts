import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: {
    authUserId: "auth-user-1",
    userEmail: "person@example.test",
    orgId: "org-1",
  } as Record<string, string | null> | null,
  getRules: vi.fn(),
  recordExposure: vi.fn(),
}));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  defineAction: (action: unknown) => action,
}));
vi.mock("@agent-native/core/feature-flags", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/feature-flags")
  >()),
  getFeatureFlagRulesStrict: (...args: unknown[]) => mocks.getRules(...args),
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestContext: () => mocks.context,
  recordFirstRunBuilderCreditsV2Exposure: (...args: unknown[]) =>
    mocks.recordExposure(...args),
}));

import {
  evaluateFeatureFlagRules,
  normalizeFeatureFlagRules,
} from "@agent-native/core/feature-flags";

import action from "./record-first-run-builder-credits-v2-exposure.js";

describe("record-first-run-builder-credits-v2-exposure", () => {
  beforeEach(() => {
    mocks.context = {
      authUserId: "auth-user-1",
      userEmail: "person@example.test",
      orgId: "org-1",
    };
    mocks.getRules
      .mockReset()
      .mockResolvedValue(normalizeFeatureFlagRules({ mode: "off" }));
    mocks.recordExposure.mockReset();
  });

  it("does not persist an assignment while the Clips flag is off", async () => {
    await expect(action.run({})).resolves.toEqual({ assignment: null });

    expect(mocks.getRules).toHaveBeenCalledWith("clips-first-run-credits-v2", {
      userEmail: "person@example.test",
      orgId: "org-1",
    });
    expect(mocks.recordExposure).not.toHaveBeenCalled();
  });

  it("uses the client email bucket for percentage rollout exposure", async () => {
    const flag = "clips-first-run-credits-v2";
    const rules = normalizeFeatureFlagRules({
      mode: "rules",
      percentage: 30,
    });
    const clientScope = {
      userEmail: "person@example.test",
      orgId: "org-1",
    };
    expect(evaluateFeatureFlagRules(flag, rules, clientScope)).toBe(true);
    expect(
      evaluateFeatureFlagRules(flag, rules, {
        ...clientScope,
        userKey: "auth-user-1",
      }),
    ).toBe(false);
    mocks.getRules.mockResolvedValue(rules);
    mocks.recordExposure.mockResolvedValue({
      experiment_id: "first_run_builder_credits_v2",
      experiment_variant: "control",
    });

    await expect(action.run({})).resolves.toEqual({
      assignment: {
        experiment_id: "first_run_builder_credits_v2",
        experiment_variant: "control",
      },
    });

    expect(mocks.getRules).toHaveBeenCalledWith(flag, clientScope);
    expect(mocks.recordExposure).toHaveBeenCalledWith({ flagEnabled: true });
  });

  it("propagates flag read failures so exposure can be retried", async () => {
    const error = new Error("temporary flag read failure");
    mocks.getRules.mockRejectedValue(error);

    await expect(action.run({})).rejects.toBe(error);

    expect(mocks.recordExposure).not.toHaveBeenCalled();
  });

  it("persists only an authenticated user's assignment after exposure", async () => {
    mocks.getRules.mockResolvedValue(normalizeFeatureFlagRules({ mode: "on" }));
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

    expect(mocks.getRules).not.toHaveBeenCalled();
    expect(mocks.recordExposure).not.toHaveBeenCalled();
  });
});
