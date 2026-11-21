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
  allowance: vi.fn(),
  onBigQuery: vi.fn(async () => true),
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
  DEFAULT_ONBOARDING_EVENT_ROW_BUDGET: 40_000,
  freezeOnboardingJourneyObservationWindow: mocks.freezeObservation,
  MAX_ONBOARDING_EVENT_ROW_BUDGET: 200_000,
  ONBOARDING_EVENTS_DEFAULT_MAX_TOTAL_BYTES_BILLED: 275_000_000_000,
  ONBOARDING_EVENTS_MAX_BYTES_BILLED: 25_000_000_000,
  ONBOARDING_EVENTS_MAX_TOTAL_BYTES_BILLED: 1_275_000_000_000,
  ONBOARDING_JOURNEY_EXPERIMENT_IDS: [
    "first_run_builder_credits",
    "first_run_builder_credits_v2",
  ],
}));

vi.mock("../server/lib/onboarding-journey-cost.js", () => ({
  estimateOnboardingJourneyEventQueryCost: mocks.estimate,
  OnboardingJourneyCostError: mocks.CostError,
}));

vi.mock("../server/lib/bigquery-agent-budget.js", () => ({
  outsideAgentIdentity: (ownerEmail: string, orgId: string | null) => ({
    ownerEmail,
    orgId,
  }),
  formatUsd: () => "$0.00",
}));

vi.mock("../server/lib/onboarding-journey-agent-budget.js", () => ({
  outsideAgentOnboardingEventBytes: mocks.allowance,
}));

vi.mock("../server/lib/bigquery-agent-approval.js", () => ({
  firstPartyQueriesRunOnBigQuery: mocks.onBigQuery,
}));

import { OutsideAgentBigQueryRefusalError } from "../server/lib/bigquery-agent-context.js";
import action from "./estimate-onboarding-journey-cost.js";

function must<T>(value: T | null | undefined, message = "Expected a value"): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

const args = action.schema.parse({
  dateFrom: "2026-10-01",
  dateTo: "2026-10-02",
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRequestOrgId.mockReturnValue("org-1");
  mocks.getRequestUserEmail.mockReturnValue("caller@example.test");
  mocks.onBigQuery.mockResolvedValue(true);
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

  it("sanitizes unexpected preparation failures", async () => {
    const privateDetail = "private setup error containing SQL and IDs";
    mocks.estimate.mockRejectedValueOnce(new Error(privateDetail));
    const signal = new AbortController().signal;

    let failure: unknown;
    try {
      await action.run(args, { signal } as ActionRunContext);
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      errorCode: "onboarding_journey_cost_preparation_failed",
      statusCode: 502,
    });
    expect((failure as Error).message).not.toContain(privateDetail);
    expect((failure as Error).message).not.toContain(
      "BigQuery could not estimate",
    );
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
      275_000_000_000,
    );
  });

  it("passes the non-production host filter to the estimator", async () => {
    const filteredArgs = action.schema.parse({
      dateFrom: "2026-10-01",
      dateTo: "2026-10-02",
      app: "design",
      excludeNonProductionHosts: true,
    });

    await action.run(filteredArgs);

    expect(mocks.estimate).toHaveBeenCalledWith(
      { userEmail: "caller@example.test", orgId: "org-1" },
      expect.objectContaining({
        app: "design",
        emailFilter: "exclude_builder",
        excludeNonProductionHosts: true,
      }),
      40_000,
      expect.any(Object),
      false,
      undefined,
      275_000_000_000,
    );
  });

  it("freezes the observation window at a continued read's watermark", async () => {
    const watermark = "2026-10-10T12:00:00.000Z";
    await action.run(
      action.schema.parse({
        dateFrom: "2026-10-01",
        dateTo: "2026-10-02",
        observationWatermark: watermark,
      }),
    );

    expect(mocks.freezeObservation).toHaveBeenCalledWith(
      expect.objectContaining({ dateFrom: "2026-10-01", dateTo: "2026-10-02" }),
      watermark,
    );
    for (const [observationWatermark, message] of [
      ["2026-02-31T12:00:00.000Z", /real UTC date/],
      ["2999-01-01T00:00:00.000Z", /in the future/],
    ] as const) {
      expect(() =>
        action.schema.parse({
          dateFrom: "2026-10-01",
          dateTo: "2026-10-02",
          observationWatermark,
        }),
      ).toThrow(message);
    }
  });

  it("classifies observation-window preparation errors before the dry-run", async () => {
    const privateDetail = "private watermark validation detail";
    mocks.freezeObservation.mockImplementationOnce(() => {
      throw new Error(privateDetail);
    });

    await expect(action.run(args)).rejects.toMatchObject({
      errorCode: "onboarding_journey_cost_preparation_failed",
      statusCode: 502,
    });
    expect(mocks.estimate).not.toHaveBeenCalled();
    expect(mocks.freezeObservation).toHaveBeenCalledOnce();
  });

  it("preserves the BigQuery dry-run failure category", async () => {
    mocks.estimate.mockRejectedValueOnce(new mocks.CostError("dry_run_failed"));

    let failure: unknown;
    try {
      await action.run(args);
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      errorCode: "onboarding_journey_cost_dry_run_failed",
      statusCode: 502,
    });
    expect((failure as Error).message).toContain("BigQuery could not estimate");
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

describe("an outside agent's estimate", () => {
  it.each(["mcp", "a2a"] as const)(
    "estimates the pages the journey will read for an outside agent (%s), under today's budget",
    async (caller) => {
      mocks.allowance.mockResolvedValueOnce({
        requested: 125_000_000_000,
        applied: 50_000_000_000,
      });
      mocks.estimate.mockResolvedValueOnce({
        maxTotalBytesBilled: 50_000_000_000,
      });

      const result = await action.run(args, { caller } as ActionRunContext);

      expect(mocks.allowance).toHaveBeenCalledWith(
        { ownerEmail: "caller@example.test", orgId: "org-1" },
        undefined,
        { followUpMode: "session", splitDesignFirstTouch: false },
        undefined,
        caller === "mcp" ? "get-onboarding-journey" : undefined,
      );
      expect(must(mocks.estimate.mock.calls[0])[6]).toBe(50_000_000_000);
      expect(result).toEqual({
        maxTotalBytesBilled: 50_000_000_000,
        maxTotalBytesBilledRequested: 125_000_000_000,
      });
    },
  );

  it("passes a cohort split to the allowance, which sets no follow-up aside for it", async () => {
    mocks.allowance.mockResolvedValueOnce({
      requested: 125_000_000_000,
      applied: 50_000_000_000,
      refusal: null,
    });
    await action.run(
      action.schema.parse({
        dateFrom: "2026-10-01",
        dateTo: "2026-10-02",
        experimentId: "first_run_builder_credits",
      }),
      { caller: "mcp" } as ActionRunContext,
    );
    expect(mocks.allowance).toHaveBeenCalledWith(
      { ownerEmail: "caller@example.test", orgId: "org-1" },
      undefined,
      {
        followUpMode: "session",
        experimentId: "first_run_builder_credits",
        splitDesignFirstTouch: false,
      },
      undefined,
      "get-onboarding-journey",
    );
    expect(() =>
      action.schema.parse({
        dateFrom: "2026-10-01",
        dateTo: "2026-10-02",
        splitDesignFirstTouch: true,
        followUpMode: "person",
      }),
    ).toThrow(/not available with cohort splits/);
    expect(() =>
      action.schema.parse({
        dateFrom: "2026-10-01",
        dateTo: "2026-10-02",
        app: "slides",
        splitDesignFirstTouch: true,
      }),
    ).toThrow(/only available for Design/);
  });

  it("keeps the in-app 275 GB default for Analytics' own callers", async () => {
    await action.run(args, { caller: "tool" } as ActionRunContext);

    expect(mocks.allowance).not.toHaveBeenCalled();
    expect(must(mocks.estimate.mock.calls[0])[6]).toBe(275_000_000_000);
  });

  it("answers with the budget refusal when today's budget cannot be read", async () => {
    mocks.allowance.mockRejectedValueOnce(
      new OutsideAgentBigQueryRefusalError({ code: "budget_unavailable" }),
    );

    await expect(
      action.run(args, { caller: "mcp" } as ActionRunContext),
    ).rejects.toMatchObject({
      errorCode: "budget_unavailable",
      statusCode: 503,
    });
    expect(mocks.estimate).not.toHaveBeenCalled();
  });

  it("answers with the refusal admission would give when not even one page fits", async () => {
    mocks.allowance.mockResolvedValueOnce({
      requested: 125_000_000_000,
      applied: 25_000_000_000,
      refusal: new OutsideAgentBigQueryRefusalError({
        code: "approval_required",
        scope: "person",
      }),
    });

    await expect(
      action.run(args, { caller: "mcp" } as ActionRunContext),
    ).rejects.toMatchObject({
      errorCode: "approval_required",
      statusCode: 429,
    });
    expect(mocks.estimate).not.toHaveBeenCalled();
  });
});
