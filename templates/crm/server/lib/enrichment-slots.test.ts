import { describe, expect, it } from "vitest";

import {
  CRM_ENRICHMENT_SLOTS,
  extractSlotFacts,
  hasVerifiedEvidence,
  runEnrichmentSlot,
  runEnrichmentSlots,
  slotCarriesContactData,
  spendSlots,
  verifySlots,
  type CrmEnrichmentSlotDeps,
  type CrmEnrichmentTarget,
} from "./enrichment-slots.js";

const TARGET: CrmEnrichmentTarget = {
  recordId: "rec_1",
  displayName: "Northwind",
  domain: "northwind.example",
  firstName: "Ada",
  lastName: "Lovelace",
  companyName: "Northwind",
};

function deps(
  overrides: Partial<CrmEnrichmentSlotDeps>,
): CrmEnrichmentSlotDeps {
  return {
    checkCredential: async () => ({ available: true, reason: "granted" }),
    execute: async () => ({}),
    ...overrides,
  };
}

describe("slot outcomes stay distinguishable", () => {
  it("reports an ungranted credential as unconfigured, without calling the provider", async () => {
    let called = false;
    const outcome = await runEnrichmentSlot({
      slot: "company",
      target: TARGET,
      phase: "verify",
      deps: deps({
        checkCredential: async () => ({
          available: false,
          reason: "No workspace connection grants this credential.",
        }),
        execute: async () => {
          called = true;
          return {};
        },
      }),
    });

    expect(outcome).toEqual({
      slot: "company",
      status: "unconfigured",
      reason: "No workspace connection grants this credential.",
    });
    expect(called).toBe(false);
  });

  it("reports a provider that answered with nothing as empty, not unconfigured and not error", async () => {
    const outcome = await runEnrichmentSlot({
      slot: "company",
      target: TARGET,
      phase: "verify",
      deps: deps({ execute: async () => ({ body: { organization: null } }) }),
    });

    expect(outcome.status).toBe("empty");
    expect(outcome).not.toHaveProperty("error");
    expect(outcome).not.toHaveProperty("reason");
  });

  it("preserves a thrown provider error verbatim", async () => {
    const outcome = await runEnrichmentSlot({
      slot: "company",
      target: TARGET,
      phase: "verify",
      deps: deps({
        execute: async () => {
          throw new Error("apollo 429 rate limited");
        },
      }),
    });

    expect(outcome).toEqual({
      slot: "company",
      status: "error",
      error: "apollo 429 rate limited",
    });
  });

  it("gives unconfigured, empty, and errored slots three different statuses in one pass", async () => {
    const outcomes = await runEnrichmentSlots({
      slots: ["company", "person", "web"],
      target: TARGET,
      phase: "verify",
      deps: deps({
        checkCredential: async ({ provider }) =>
          provider === "dataforseo"
            ? { available: false, reason: "not granted" }
            : { available: true, reason: "granted" },
        execute: async (args) => {
          if (args.path.includes("people/match")) {
            throw new Error("upstream timeout");
          }
          return { body: {} };
        },
      }),
    });

    expect(outcomes.map((outcome) => [outcome.slot, outcome.status])).toEqual([
      ["company", "empty"],
      ["person", "error"],
      ["web", "unconfigured"],
    ]);
    // The three are separate states, so a caller cannot count them together.
    expect(new Set(outcomes.map((outcome) => outcome.status)).size).toBe(3);
  });

  it("does not call a provider for a record missing the identifier it resolves against", async () => {
    let called = false;
    const outcome = await runEnrichmentSlot({
      slot: "company",
      target: { recordId: "rec_2", displayName: "Unknown Co" },
      phase: "verify",
      deps: deps({
        execute: async () => {
          called = true;
          return {};
        },
      }),
    });

    expect(outcome.status).toBe("skipped");
    expect(called).toBe(false);
  });

  it("does not report a failing credential check as unconfigured", async () => {
    const outcome = await runEnrichmentSlot({
      slot: "company",
      target: TARGET,
      phase: "verify",
      deps: deps({
        checkCredential: async () => {
          throw new Error("vault unreachable");
        },
      }),
    });

    // "we could not find out" is not "there is none".
    expect(outcome).toEqual({
      slot: "company",
      status: "error",
      error: "vault unreachable",
    });
  });
});

describe("phase separation", () => {
  it("excludes every contact-bearing slot from the verification phase", () => {
    const requested = [...CRM_ENRICHMENT_SLOTS];
    expect(verifySlots(requested).some(slotCarriesContactData)).toBe(false);
    expect(spendSlots(requested).every(slotCarriesContactData)).toBe(true);
    expect(spendSlots(requested)).toContain("contact");
  });

  it("throws rather than degrading when asked to verify with a paid slot", async () => {
    await expect(
      runEnrichmentSlot({
        slot: "contact",
        target: TARGET,
        phase: "verify",
        deps: deps({}),
      }),
    ).rejects.toThrow(/cannot run in the verification phase/);
  });

  it("never carries contact data out of a verification pass", async () => {
    const outcomes = await runEnrichmentSlots({
      slots: verifySlots([...CRM_ENRICHMENT_SLOTS]),
      target: TARGET,
      phase: "verify",
      deps: deps({
        // A provider that returns contact data anyway: the slot's fact map is
        // what bounds the evidence, not the provider's generosity.
        execute: async () => ({
          body: {
            organization: { industry: "software" },
            person: {
              title: "CTO",
              email: "ada@northwind.example",
              sanitized_phone: "+15550101",
            },
          },
        }),
      }),
    });

    const factKeys = outcomes.flatMap((outcome) =>
      outcome.status === "ok" ? outcome.facts.map((fact) => fact.key) : [],
    );
    expect(factKeys).not.toContain("email");
    expect(factKeys).not.toContain("phone");
    expect(factKeys).toContain("industry");
  });
});

describe("fact extraction", () => {
  it("reads dot paths through arrays and drops empty values", () => {
    const facts = extractSlotFacts("web", {
      body: {
        tasks: [
          {
            result: [
              {
                items: [
                  {
                    title: "Northwind raises Series B",
                    url: "https://news.example/northwind",
                    description: "   ",
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    expect(facts).toEqual([
      { key: "topResultTitle", value: "Northwind raises Series B" },
      { key: "topResultUrl", value: "https://news.example/northwind" },
    ]);
  });

  it("treats a record with only empty and errored slots as unverified", () => {
    expect(
      hasVerifiedEvidence([
        {
          slot: "company",
          status: "empty",
          observedAt: "2026-07-26T00:00:00Z",
        },
        { slot: "person", status: "error", error: "boom" },
      ]),
    ).toBe(false);
    expect(
      hasVerifiedEvidence([
        {
          slot: "company",
          status: "ok",
          facts: [{ key: "industry", value: "software" }],
          observedAt: "2026-07-26T00:00:00Z",
        },
      ]),
    ).toBe(true);
  });
});

describe("wire contract", () => {
  it("never names a vendor in a slot outcome", async () => {
    const outcomes = await runEnrichmentSlots({
      slots: ["company", "person", "web", "calls"],
      target: TARGET,
      phase: "verify",
      deps: deps({
        checkCredential: async () => ({
          available: false,
          reason: "no grant for this slot",
        }),
      }),
    });

    const serialized = JSON.stringify(outcomes).toLowerCase();
    for (const vendor of ["apollo", "dataforseo", "gong", "exa", "clearbit"]) {
      expect(serialized).not.toContain(vendor);
    }
  });
});
