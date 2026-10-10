import type { ActionRunContext } from "@agent-native/core/action";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestOrgId: vi.fn(() => "org-1"),
  getRequestUserEmail: vi.fn(() => "caller@example.test" as string | null),
  freezeObservation: vi.fn(() => ({
    observationCutoff: "2026-10-10T12:00:00.000Z",
    observationDate: "2026-10-10",
  })),
  estimate: vi.fn(),
  CostError: class OnboardingJourneyCostError extends Error {
    constructor(readonly code: string) {
      super("The scoped onboarding journey cost estimate is unavailable.");
    }
  },
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: <T>(definition: T) => definition,
  fail: (message: string, options: Record<string, unknown> = {}) => {
    throw Object.assign(new Error(message), options);
  },
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("../server/lib/onboarding-journey.js", () => ({
  freezeOnboardingJourneyObservationWindow: mocks.freezeObservation,
}));

vi.mock("../server/lib/onboarding-journey-cost.js", () => ({
  estimateOnboardingJourneyEventQueryCost: mocks.estimate,
  OnboardingJourneyCostError: mocks.CostError,
}));

import action from "./estimate-onboarding-journey-cost.js";

const args = action.schema.parse({
  dateFrom: "2026-10-01",
  dateTo: "2026-10-02",
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRequestOrgId.mockReturnValue("org-1");
  mocks.getRequestUserEmail.mockReturnValue("caller@example.test");
});

describe("estimate-onboarding-journey-cost action", () => {
  it("requires the authenticated caller scope", async () => {
    mocks.getRequestUserEmail.mockReturnValueOnce(null);

    await expect(action.run(args)).rejects.toMatchObject({
      errorCode: "unauthenticated",
      statusCode: 401,
    });
    expect(mocks.estimate).not.toHaveBeenCalled();
  });

  it("sanitizes unexpected provider details from action failures", async () => {
    const privateDetail = "private provider error containing SQL and IDs";
    mocks.estimate.mockRejectedValueOnce(new Error(privateDetail));
    const signal = new AbortController().signal;

    let failure: unknown;
    try {
      await action.run(args, { signal } as ActionRunContext);
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      errorCode: "onboarding_journey_cost_dry_run_failed",
      statusCode: 502,
    });
    expect((failure as Error).message).not.toContain(privateDetail);
    expect(mocks.estimate).toHaveBeenCalledWith(
      { userEmail: "caller@example.test", orgId: "org-1" },
      {
        dateFrom: "2026-10-01",
        dateTo: "2026-10-02",
        app: "all",
        emailFilter: "exclude_builder",
      },
      40_000,
      {
        observationCutoff: "2026-10-10T12:00:00.000Z",
        observationDate: "2026-10-10",
      },
      false,
      signal,
    );
  });

  it("maps typed missing-estimate failures without exposing internals", async () => {
    mocks.estimate.mockRejectedValueOnce(
      new mocks.CostError("estimate_unavailable"),
    );

    let failure: unknown;
    try {
      await action.run(args);
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      errorCode: "onboarding_journey_cost_estimate_unavailable",
      statusCode: 502,
    });
    expect((failure as Error).message).toContain("no usable byte estimate");
  });
});
