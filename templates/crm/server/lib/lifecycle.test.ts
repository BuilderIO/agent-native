// Transition-rule tests for the CRM status lifecycle. These cover the pure rule
// surface — every blocked case and the sentence it answers with. The bulk
// partition, the concurrency claim, and the bitemporal write are covered against
// a real database in actions/crm-lifecycle-actions.test.ts.

import { describe, expect, it } from "vitest";

import {
  crmStatusBlockReason,
  type CrmLifecycle,
  type CrmStatusOption,
} from "./lifecycle.js";

function option(
  value: string,
  overrides: Partial<CrmStatusOption> = {},
): CrmStatusOption {
  return {
    value,
    title: value,
    position: 0,
    archived: false,
    celebrate: false,
    targetDays: null,
    ...overrides,
  };
}

function lifecycle(
  overrides: {
    options?: CrmStatusOption[];
    authority?: CrmLifecycle["attribute"]["authority"];
    archived?: boolean;
  } = {},
): CrmLifecycle {
  const options = overrides.options ?? [
    option("new"),
    option("in-progress"),
    option("won"),
    option("lost", { archived: true }),
  ];
  return {
    attribute: {
      id: "attr_stage",
      apiSlug: "stage",
      attributeType: "status",
      multi: false,
      historyTracked: true,
      valueType: "enum",
      storagePolicy: "local-authoritative",
      fieldPolicyId: "attr_stage",
      label: "Stage",
      authority: overrides.authority ?? "local-authoritative",
      archived: overrides.archived ?? false,
    },
    options,
    enterableValues: options
      .filter((entry) => !entry.archived)
      .map((entry) => entry.value),
    knownValues: options.map((entry) => entry.value),
  };
}

describe("crmStatusBlockReason", () => {
  it("allows every live option from every state, including unset", () => {
    const rules = lifecycle();
    for (const from of [null, "new", "in-progress", "won"]) {
      for (const to of ["new", "in-progress", "won"]) {
        expect(crmStatusBlockReason(rules, { from, to })).toBeNull();
      }
    }
  });

  it("allows an idempotent re-write of the current status", () => {
    expect(
      crmStatusBlockReason(lifecycle(), { from: "won", to: "won" }),
    ).toBeNull();
  });

  it("always allows LEAVING an archived status", () => {
    // The way out of a retired stage must not itself be blocked, or every row
    // parked there when it was archived is stuck forever.
    expect(
      crmStatusBlockReason(lifecycle(), { from: "lost", to: "new" }),
    ).toBeNull();
  });

  it("blocks moving INTO an archived status and names the live ones", () => {
    const block = crmStatusBlockReason(lifecycle(), {
      from: "new",
      to: "lost",
    });
    expect(block).toMatchObject({ code: "archived-status" });
    expect(block?.message).toBe(
      'Cannot move into "lost" — that value of "Stage" is archived. Pick one of: new, in-progress, won.',
    );
  });

  it("blocks an undeclared status and lists what is declared", () => {
    const block = crmStatusBlockReason(lifecycle(), {
      from: "new",
      to: "invented",
    });
    expect(block).toMatchObject({ code: "unknown-status" });
    expect(block?.message).toBe(
      '"invented" is not a value of "Stage". Known values: new, in-progress, won, lost. Add the option before moving anything into it.',
    );
  });

  it("blocks a provider-owned attribute rather than writing a local lie", () => {
    const block = crmStatusBlockReason(lifecycle({ authority: "provider" }), {
      from: "new",
      to: "won",
    });
    expect(block).toMatchObject({ code: "provider-authority" });
    expect(block?.message).toBe(
      'Cannot set "Stage" locally — the connected provider owns this attribute. Prepare a change and complete it in the provider instead.',
    );
  });

  it("blocks an archived attribute before it looks at the value at all", () => {
    const block = crmStatusBlockReason(lifecycle({ archived: true }), {
      from: "new",
      to: "won",
    });
    expect(block).toMatchObject({ code: "attribute-archived" });
    expect(block?.message).toBe(
      'Cannot set "Stage" — the attribute is archived. Unarchive it before moving anything through it.',
    );
  });

  it("blocks a merged or deleted record", () => {
    const block = crmStatusBlockReason(lifecycle(), {
      from: "new",
      to: "won",
      recordTombstoned: true,
    });
    expect(block).toMatchObject({ code: "record-tombstoned" });
    expect(block?.message).toBe(
      'Cannot move a merged or deleted record through "Stage".',
    );
  });

  it("reports the attribute problem before the value problem", () => {
    // Telling someone their stage name is wrong when the real problem is that
    // the provider owns the attribute sends them to fix the wrong thing.
    expect(
      crmStatusBlockReason(lifecycle({ authority: "provider" }), {
        from: "new",
        to: "invented",
      }),
    ).toMatchObject({ code: "provider-authority" });
  });

  it("names an option-less attribute honestly instead of listing nothing", () => {
    const block = crmStatusBlockReason(lifecycle({ options: [] }), {
      from: null,
      to: "won",
    });
    expect(block?.message).toContain("(none defined)");
  });
});
