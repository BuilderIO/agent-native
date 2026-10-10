import type { ActionRunContext } from "@agent-native/core/action";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOnboardingJourney: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: <T>(definition: T) => definition,
  fail: (message: string, options: Record<string, unknown>) => {
    throw Object.assign(new Error(message), options);
  },
}));

vi.mock("@agent-native/core/server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/server")>();
  return {
    ...actual,
    getRequestOrgId: () => "org-1",
    getRequestUserEmail: () => "owner@example.test",
  };
});

vi.mock("../server/lib/onboarding-journey.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../server/lib/onboarding-journey.js")
    >();
  return { ...actual, getOnboardingJourney: mocks.getOnboardingJourney };
});

import { OnboardingJourneyReadError } from "../server/lib/onboarding-journey.js";
import action from "./get-onboarding-journey.js";

const args = {
  dateFrom: "2026-10-01",
  dateTo: "2026-10-01",
  app: "all",
  emailFilter: "exclude_builder",
  format: "summary",
  followUpMode: "person",
  maxDepth: 8,
  minNodeSessions: 1,
  examplesPerNode: 2,
  maxEventRows: 2_000,
  maxNodes: 60,
  settleMs: 300,
  recency: "newest",
};

beforeEach(() => mocks.getOnboardingJourney.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("get-onboarding-journey read failures", () => {
  it("forwards the action cancellation signal to the journey read", async () => {
    mocks.getOnboardingJourney.mockResolvedValueOnce({ status: "complete" });
    const signal = new AbortController().signal;

    await action.run(args, { signal } as ActionRunContext);

    expect(mocks.getOnboardingJourney).toHaveBeenCalledWith(
      { userEmail: "owner@example.test", orgId: "org-1" },
      expect.objectContaining({
        dateFrom: args.dateFrom,
        dateTo: args.dateTo,
      }),
      signal,
    );
  });

  it.each([
    ["session_followup", "journey_session_followup_unclassified"],
    ["person_followup", "journey_person_followup_unclassified"],
  ] as const)("returns a safe error for %s", async (stage, errorCode) => {
    const privateDetail = "private SQL policy detail";
    mocks.getOnboardingJourney.mockRejectedValueOnce(
      new OnboardingJourneyReadError(new Error(privateDetail), null, stage),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    let failure: unknown;
    try {
      await action.run(args);
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      errorCode,
      statusCode: 502,
    });
    expect((failure as Error).message).toContain(stage);
    expect((failure as Error).message).not.toContain(privateDetail);
    expect(log).toHaveBeenCalledWith(
      "[get-onboarding-journey] failed",
      expect.objectContaining({
        stage,
        failureKind: "query_error",
        failureType: "error",
        backendStatus: null,
        backendReason: null,
        backendOperation: null,
      }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain(privateDetail);
  });
});
