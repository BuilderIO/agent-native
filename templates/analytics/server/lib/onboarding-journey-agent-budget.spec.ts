import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn() }));

vi.mock("./bigquery-agent-budget.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./bigquery-agent-budget.js")>()),
  readBigQueryAgentBudget: mocks.read,
}));

import {
  BigQueryAgentBudgetUnavailableError,
  OUTSIDE_AGENT_JOB_CAP_BYTES,
  OUTSIDE_AGENT_ORG_LIMIT_BYTES,
  OUTSIDE_AGENT_PERSON_BASE_BYTES,
  OUTSIDE_AGENT_PERSON_CEILING_BYTES,
} from "./bigquery-agent-budget.js";
import { OutsideAgentBigQueryRefusalError } from "./bigquery-agent-context.js";
import { outsideAgentOnboardingEventBytes } from "./onboarding-journey-agent-budget.js";

const GB = 1_000_000_000;
const identity = { ownerEmail: "alice@example.com", orgId: "org-1" };
const session = { followUpMode: "session" } as const;
const person = { followUpMode: "person" } as const;
const cohort = {
  followUpMode: "session",
  experimentId: "first_run_builder_credits",
} as const;

function snapshot({
  personRemaining = OUTSIDE_AGENT_PERSON_BASE_BYTES,
  orgRemaining = OUTSIDE_AGENT_ORG_LIMIT_BYTES,
  approvedToday = false,
} = {}) {
  const personLimit = approvedToday
    ? OUTSIDE_AGENT_PERSON_CEILING_BYTES
    : OUTSIDE_AGENT_PERSON_BASE_BYTES;
  return {
    utcDay: "2026-11-17",
    resetsAt: "2026-11-18T00:00:00.000Z",
    jobCapBytes: OUTSIDE_AGENT_JOB_CAP_BYTES,
    person: {
      limitBytes: personLimit,
      settledBytes: personLimit - personRemaining,
      reservedBytes: 0,
      remainingBytes: personRemaining,
      baseAllowanceBytes: OUTSIDE_AGENT_PERSON_BASE_BYTES,
      ceilingBytes: OUTSIDE_AGENT_PERSON_CEILING_BYTES,
      approvedToday,
    },
    org: {
      limitBytes: OUTSIDE_AGENT_ORG_LIMIT_BYTES,
      settledBytes: OUTSIDE_AGENT_ORG_LIMIT_BYTES - orgRemaining,
      reservedBytes: 0,
      remainingBytes: orgRemaining,
    },
    limitsSource: { person: "default", org: "default" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("an outside agent's onboarding journey allowance", () => {
  it("keeps the 125 GB default when today's budget pays for it and its follow-up", async () => {
    mocks.read.mockResolvedValueOnce(snapshot());
    await expect(
      outsideAgentOnboardingEventBytes(identity, undefined, session),
    ).resolves.toEqual({
      requested: 125 * GB,
      applied: 125 * GB,
      refusal: null,
    });
    expect(mocks.read).toHaveBeenCalledWith(identity);
  });

  it("caps the pages at what is left after the follow-ups", async () => {
    mocks.read.mockResolvedValue(snapshot({ personRemaining: 70 * GB }));
    // $0.40 left: one 25 GB follow-up and one 25 GB page.
    await expect(
      outsideAgentOnboardingEventBytes(identity, 1_275 * GB, session),
    ).resolves.toMatchObject({ applied: 25 * GB, refusal: null });
    // A cohort tree runs no follow-up, so two pages fit; person mode runs two
    // follow-ups, so none does.
    await expect(
      outsideAgentOnboardingEventBytes(identity, 1_275 * GB, cohort),
    ).resolves.toMatchObject({ applied: 50 * GB, refusal: null });
    await expect(
      outsideAgentOnboardingEventBytes(identity, 1_275 * GB, person),
    ).resolves.toMatchObject({
      applied: 25 * GB,
      refusal: { code: "approval_required", reservedBytes: 75 * GB },
    });
  });

  it("refuses as admission would when not even one page fits with its follow-up", async () => {
    mocks.read.mockResolvedValueOnce(snapshot({ personRemaining: 40 * GB }));
    const allowance = await outsideAgentOnboardingEventBytes(
      identity,
      undefined,
      session,
    );
    expect(allowance.refusal).toBeInstanceOf(OutsideAgentBigQueryRefusalError);
    expect(allowance.refusal).toMatchObject({
      code: "approval_required",
      scope: "person",
      reservedBytes: 50 * GB,
    });
  });

  it("names the organization's limit when that is what stops it", async () => {
    mocks.read.mockResolvedValueOnce(snapshot({ orgRemaining: 20 * GB }));
    await expect(
      outsideAgentOnboardingEventBytes(identity, undefined, cohort),
    ).resolves.toMatchObject({
      refusal: { code: "budget_exhausted", scope: "org" },
    });
  });

  it("names the person's limit once today's approval has been used up", async () => {
    mocks.read.mockResolvedValueOnce(
      snapshot({ personRemaining: 10 * GB, approvedToday: true }),
    );
    await expect(
      outsideAgentOnboardingEventBytes(identity, undefined, cohort),
    ).resolves.toMatchObject({
      refusal: { code: "budget_exhausted", scope: "person" },
    });
  });

  it("refuses with budget_unavailable when today's budget cannot be read", async () => {
    mocks.read.mockRejectedValueOnce(
      new BigQueryAgentBudgetUnavailableError("db down"),
    );
    await expect(
      outsideAgentOnboardingEventBytes(identity, undefined, session),
    ).rejects.toMatchObject({ code: "budget_unavailable" });
  });
});
