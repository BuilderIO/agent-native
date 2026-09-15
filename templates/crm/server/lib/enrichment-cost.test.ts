import { describe, expect, it } from "vitest";

import {
  CRM_DEFAULT_ENRICHMENT_BUDGET_UNITS,
  CrmEnrichmentBudgetError,
  CrmEnrichmentRunConflictError,
  CrmEnrichmentScopeError,
  MAX_ENRICHMENT_RECORDS_PER_RUN,
  assertNoInFlightRun,
  assertRecordCountWithinCap,
  assertWithinEnrichmentBudget,
  buildPhaseBInput,
  claimEnrichmentRun,
  currentSpendPeriodStart,
  enrichmentScopeKey,
  estimateEnrichment,
  evaluateEnrichmentBudget,
  resolveEnrichmentBudgetUnits,
  resolveEnrichmentScope,
  type CrmVerifiedRecord,
} from "./enrichment-cost.js";

describe("estimate", () => {
  it("prices only the slots the phase will actually run", () => {
    const verify = estimateEnrichment({
      phase: "verify",
      slots: ["company", "person", "contact"],
      recordCount: 4,
    });

    expect(verify.slots).toEqual(["company", "person"]);
    expect(verify.lineItems).toEqual([
      { slot: "company", recordCount: 4, unitCost: 1, cost: 4 },
      { slot: "person", recordCount: 4, unitCost: 1, cost: 4 },
    ]);
    expect(verify.totalCost).toBe(8);
  });

  it("quotes the paid phase from the contact-bearing slots alone", () => {
    const spend = estimateEnrichment({
      phase: "spend",
      slots: ["company", "person", "contact"],
      recordCount: 4,
    });

    expect(spend.slots).toEqual(["contact"]);
    expect(spend.totalCost).toBe(40);
    // A verification quote can never be mistaken for a paid one.
    expect(spend.totalCost).toBeGreaterThan(
      estimateEnrichment({
        phase: "verify",
        slots: ["company", "person", "contact"],
        recordCount: 4,
      }).totalCost,
    );
  });

  it("costs nothing when the phase has no slots to run", () => {
    const spend = estimateEnrichment({
      phase: "spend",
      slots: ["company"],
      recordCount: 100,
    });
    expect(spend.lineItems).toEqual([]);
    expect(spend.totalCost).toBe(0);
  });
});

describe("budget cap", () => {
  const periodStart = "2026-07-01T00:00:00.000Z";

  it("allows a run that fits and reports what is left", () => {
    const decision = evaluateEnrichmentBudget({
      estimatedUnits: 40,
      spendToDate: { actorUnits: 60, workspaceUnits: 900 },
      capUnits: 500,
      periodStart,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.remainingUnits).toBe(400);
    expect(decision.reason).toBeUndefined();
    expect(() => assertWithinEnrichmentBudget(decision)).not.toThrow();
  });

  it("refuses a run that would pass the cap", () => {
    const decision = evaluateEnrichmentBudget({
      estimatedUnits: 100,
      spendToDate: { actorUnits: 450, workspaceUnits: 9000 },
      capUnits: 500,
      periodStart,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.remainingUnits).toBe(-50);
    expect(decision.reason).toContain("450");
    expect(() => assertWithinEnrichmentBudget(decision)).toThrow(
      CrmEnrichmentBudgetError,
    );
    try {
      assertWithinEnrichmentBudget(decision);
    } catch (error) {
      expect(error).toBeInstanceOf(CrmEnrichmentBudgetError);
      expect((error as CrmEnrichmentBudgetError).statusCode).toBe(422);
      expect((error as CrmEnrichmentBudgetError).code).toBe(
        "crm-enrichment-budget-exceeded",
      );
    }
  });

  it("caps on the actor's spend, not the workspace's", () => {
    const decision = evaluateEnrichmentBudget({
      estimatedUnits: 10,
      // A busy workspace must not exhaust one person's budget.
      spendToDate: { actorUnits: 5, workspaceUnits: 100_000 },
      capUnits: 500,
      periodStart,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.spendToDate.workspaceUnits).toBe(100_000);
  });
});

describe("configuration", () => {
  it("falls back to the default when no override is set", () => {
    expect(resolveEnrichmentBudgetUnits({})).toBe(
      CRM_DEFAULT_ENRICHMENT_BUDGET_UNITS,
    );
    expect(
      resolveEnrichmentBudgetUnits({ CRM_ENRICHMENT_BUDGET_UNITS: "" }),
    ).toBe(CRM_DEFAULT_ENRICHMENT_BUDGET_UNITS);
  });

  it("reads a valid override", () => {
    expect(
      resolveEnrichmentBudgetUnits({ CRM_ENRICHMENT_BUDGET_UNITS: "25" }),
    ).toBe(25);
    expect(
      resolveEnrichmentBudgetUnits({ CRM_ENRICHMENT_BUDGET_UNITS: "0" }),
    ).toBe(0);
  });

  it("throws on an unreadable override instead of restoring the default", () => {
    expect(() =>
      resolveEnrichmentBudgetUnits({ CRM_ENRICHMENT_BUDGET_UNITS: "lots" }),
    ).toThrow(/must be a non-negative number/);
    expect(() =>
      resolveEnrichmentBudgetUnits({ CRM_ENRICHMENT_BUDGET_UNITS: "-5" }),
    ).toThrow(/must be a non-negative number/);
  });

  it("anchors the period to the start of the UTC month", () => {
    expect(currentSpendPeriodStart(new Date("2026-07-26T18:30:00Z"))).toBe(
      "2026-07-01T00:00:00.000Z",
    );
  });
});

describe("the launch gate", () => {
  const verified = (
    recordId: string,
    approved: boolean,
  ): CrmVerifiedRecord => ({
    target: { recordId, displayName: recordId, domain: `${recordId}.example` },
    outcomes: [
      {
        slot: "company",
        status: "ok",
        facts: [{ key: "industry", value: "software" }],
        observedAt: "2026-07-26T00:00:00.000Z",
      },
    ],
    approved,
  });

  it("builds the paid input set from approvals rather than filtering the full set", () => {
    const input = buildPhaseBInput([
      verified("rec_a", true),
      verified("rec_b", false),
      verified("rec_c", true),
    ]);

    expect(input.recordIds).toEqual(["rec_a", "rec_c"]);
    // Structural, not incidental: the unapproved record is absent from every
    // member of the value the paid pass receives, and the value cannot be
    // widened afterwards.
    expect(JSON.stringify(input)).not.toContain("rec_b");
    expect(Object.isFrozen(input)).toBe(true);
    expect(Object.isFrozen(input.targets)).toBe(true);
    expect(() => {
      (input.targets as CrmVerifiedRecord["target"][]).push(
        verified("rec_b", false).target,
      );
    }).toThrow();
  });

  it("refuses a scope larger than one run may touch instead of truncating it", () => {
    expect(() =>
      assertRecordCountWithinCap(MAX_ENRICHMENT_RECORDS_PER_RUN),
    ).not.toThrow();
    expect(() =>
      assertRecordCountWithinCap(MAX_ENRICHMENT_RECORDS_PER_RUN + 1),
    ).toThrow(CrmEnrichmentScopeError);
  });

  it("gives an ad-hoc record set a stable scope id that only an identical set shares", async () => {
    const first = await resolveEnrichmentScope({
      kind: "records",
      recordIds: ["rec_b", "rec_a"],
    });
    const sameSet = await resolveEnrichmentScope({
      kind: "records",
      recordIds: ["rec_a", "rec_b", "rec_a"],
    });
    const otherSet = await resolveEnrichmentScope({
      kind: "records",
      recordIds: ["rec_a", "rec_c"],
    });

    expect(first.id).toBe(sameSet.id);
    expect(first.id).not.toBe(otherSet.id);
    await expect(
      resolveEnrichmentScope({ kind: "list", recordIds: [] }),
    ).rejects.toThrow(CrmEnrichmentScopeError);
  });

  it("produces an empty paid input when nothing was approved", () => {
    const input = buildPhaseBInput([
      verified("rec_a", false),
      verified("rec_b", false),
    ]);
    expect(input.targets).toEqual([]);
    expect(
      estimateEnrichment({
        phase: "spend",
        slots: ["contact"],
        recordCount: input.recordIds.length,
      }).totalCost,
    ).toBe(0);
  });

  it("refuses a second run while one is in flight for the same scope", () => {
    const scope = { kind: "list" as const, id: "list_1" };
    expect(enrichmentScopeKey(scope)).toBe("list:list_1");
    expect(() =>
      assertNoInFlightRun({ scope, phase: "spend", inFlight: [] }),
    ).not.toThrow();
    expect(() =>
      assertNoInFlightRun({
        scope,
        phase: "spend",
        inFlight: [{ id: "run_7" }],
      }),
    ).toThrow(CrmEnrichmentRunConflictError);
    try {
      assertNoInFlightRun({
        scope,
        phase: "spend",
        inFlight: [{ id: "run_7" }],
      });
    } catch (error) {
      expect((error as CrmEnrichmentRunConflictError).statusCode).toBe(409);
      expect((error as CrmEnrichmentRunConflictError).runId).toBe("run_7");
      expect((error as Error).message).toContain("list:list_1");
    }
  });

  it("lets exactly one of two concurrent workers claim a run", async () => {
    let stored: string | null = null;
    const claim = (nonce: string) =>
      claimEnrichmentRun({
        nonce,
        // Last write wins, as an UPDATE would.
        write: async (value) => {
          stored = value;
        },
        readBack: async () => stored,
      });

    const [first, second] = await Promise.all([
      claim("nonce-a"),
      claim("nonce-b"),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
  });

  it("lets the claim be retried after a worker crashed before reading it back", async () => {
    let stored: string | null = null;

    // Worker one writes its nonce and dies before it can read back.
    await expect(
      claimEnrichmentRun({
        nonce: "nonce-crashed",
        write: async (value) => {
          stored = value;
        },
        readBack: async () => {
          throw new Error("process died");
        },
      }),
    ).rejects.toThrow("process died");
    expect(stored).toBe("nonce-crashed");

    // The persisted row survives, so a later worker can take the claim and
    // finish the setup rather than the run being stranded.
    await expect(
      claimEnrichmentRun({
        nonce: "nonce-resumed",
        write: async (value) => {
          stored = value;
        },
        readBack: async () => stored,
      }),
    ).resolves.toBe(true);
  });
});
