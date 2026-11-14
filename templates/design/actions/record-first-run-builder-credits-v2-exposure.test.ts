import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: {
    authUserId: "auth-user-1",
    userEmail: "person@example.test",
    orgId: "org-1",
  } as Record<string, string | null> | null,
  config: "v2" as "v1" | "v2",
  resolveAssignment: vi.fn(),
  recordExposure: vi.fn(),
}));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  defineAction: (action: unknown) => action,
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestContext: () => mocks.context,
  getAppConfig: () => ({
    onboarding: {
      firstRunCreditsExperiment: "v2",
      firstRunCreditsExperimentOverride:
        mocks.config === "v1" ? "v1" : undefined,
    },
  }),
  resolveFirstRunBuilderCreditsV2Assignment: (...args: unknown[]) =>
    mocks.resolveAssignment(...args),
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
    mocks.config = "v2";
    mocks.resolveAssignment.mockReset();
    mocks.recordExposure.mockReset();
  });

  // oracle-change: configuration replaces org-scoped feature flag evaluation.
  it("honors the v1 kill switch", async () => {
    mocks.config = "v1";
    await expect(action.run({})).resolves.toEqual({ assignment: null });
    expect(mocks.resolveAssignment).not.toHaveBeenCalled();
    expect(mocks.recordExposure).not.toHaveBeenCalled();
  });

  it("resolves the authenticated assignment without persisting before confirmation", async () => {
    mocks.resolveAssignment.mockResolvedValue({
      experiment_id: "first_run_builder_credits_v2",
      experiment_variant: "control",
    });

    await expect(action.run({})).resolves.toEqual({
      assignment: {
        experiment_id: "first_run_builder_credits_v2",
        experiment_variant: "control",
      },
    });

    expect(mocks.resolveAssignment).toHaveBeenCalledWith({ flagEnabled: true });
    expect(mocks.recordExposure).not.toHaveBeenCalled();
  });

  it("persists the authenticated user's assignment only after UI confirmation", async () => {
    mocks.recordExposure.mockResolvedValue({
      experiment_id: "first_run_builder_credits_v2",
      experiment_variant: "credits",
    });

    await expect(action.run({ confirmedVariant: "credits" })).resolves.toEqual({
      assignment: {
        experiment_id: "first_run_builder_credits_v2",
        experiment_variant: "credits",
      },
    });

    expect(mocks.recordExposure).toHaveBeenCalledWith({
      flagEnabled: true,
      experimentVariant: "credits",
    });
    expect(mocks.resolveAssignment).not.toHaveBeenCalled();
  });

  it("does not assign when the request has no authenticated user", async () => {
    mocks.context = null;

    await expect(action.run({})).resolves.toEqual({ assignment: null });

    expect(mocks.resolveAssignment).not.toHaveBeenCalled();
    expect(mocks.recordExposure).not.toHaveBeenCalled();
  });
});
