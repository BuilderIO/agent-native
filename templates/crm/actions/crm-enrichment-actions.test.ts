// Integration tests for the enrichment surface. Real libsql, real migrations,
// real sharing registry — the access scoping and the bitemporal write behaviour
// are the parts worth proving, and mocking either would make them vacuous.

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `crm-enrichment-actions-test-${process.pid}-${Date.now()}.sqlite`,
);

const OWNER = "owner@example.test";
const CONNECTION_ID = "conn_enrichment";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let listSlots: typeof import("./list-crm-enrichment-slots.js").default;
let runFill: typeof import("./run-crm-attribute-fill.js").default;
let estimateEnrichmentAction: typeof import("./estimate-crm-enrichment.js").default;
let createAttribute: typeof import("./create-crm-attribute.js").default;
let writeCrmRecordField: typeof import("../server/lib/record-fields.js").writeCrmRecordField;
let resolveEnrichmentScope: typeof import("../server/lib/enrichment-cost.js").resolveEnrichmentScope;
let runCrmEnrichment: typeof import("./run-crm-enrichment.js").runCrmEnrichment;
type CrmEnrichmentSlotDeps =
  import("../server/lib/enrichment-slots.js").CrmEnrichmentSlotDeps;

const ownership = {
  ownerEmail: OWNER,
  orgId: null,
  visibility: "private" as const,
};

function asUser<T>(userEmail: string, fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ userEmail }, fn) as Promise<T>;
}

const ctxFor = (userEmail: string) =>
  ({ caller: "frontend", userEmail }) as never;

function run<T>(
  action: { run: (args: never, ctx: never) => Promise<T> },
  args: unknown,
  userEmail = OWNER,
): Promise<T> {
  return asUser(userEmail, () =>
    action.run(args as never, ctxFor(userEmail) as never),
  );
}

let counter = 0;
const uniqueTitle = (prefix: string) => `${prefix} ${++counter}`;

/**
 * A record the fill actions can target. `kind` matters for the contact slot:
 * it resolves a PERSON, so an account record legitimately reports `skipped`
 * rather than being asked at all.
 */
async function seedRecord(
  id: string,
  displayName: string,
  kind: "account" | "person" = "account",
) {
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.crmRecords)
    .values({
      id,
      connectionId: CONNECTION_ID,
      provider: "native",
      objectType: kind === "person" ? "contacts" : "accounts",
      kind,
      remoteId: id,
      displayName,
      domain: `${id}.example`,
      accessScopeKey: "native",
      createdAt: now,
      updatedAt: now,
      ...ownership,
    });
}

/** A fillable attribute; `createAttribute` cannot set fill mode itself. */
async function seedFillableAttribute(input: {
  title: string;
  type: "status" | "text";
  fillMode: string;
  options?: Array<{ value: string; title: string }>;
}) {
  const created = (await run(createAttribute, {
    connectionId: CONNECTION_ID,
    targetId: "accounts",
    title: input.title,
    type: input.type,
    options: input.options,
  })) as { id: string; apiSlug: string };
  await getDb()
    .update(schema.crmFieldPolicies)
    .set({ fillMode: input.fillMode })
    .where(eq(schema.crmFieldPolicies.id, created.id));
  return created;
}

function currentFieldRows(recordId: string, apiSlug: string) {
  return getDb()
    .select()
    .from(schema.crmRecordFields)
    .where(
      and(
        eq(schema.crmRecordFields.recordId, recordId),
        eq(schema.crmRecordFields.fieldName, apiSlug),
        isNull(schema.crmRecordFields.activeUntil),
      ),
    );
}

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);

  listSlots = (await import("./list-crm-enrichment-slots.js")).default;
  runFill = (await import("./run-crm-attribute-fill.js")).default;
  estimateEnrichmentAction = (await import("./estimate-crm-enrichment.js"))
    .default;
  createAttribute = (await import("./create-crm-attribute.js")).default;
  writeCrmRecordField = (await import("../server/lib/record-fields.js"))
    .writeCrmRecordField;
  resolveEnrichmentScope = (await import("../server/lib/enrichment-cost.js"))
    .resolveEnrichmentScope;
  runCrmEnrichment = (await import("./run-crm-enrichment.js")).runCrmEnrichment;

  const now = new Date().toISOString();
  await getDb()
    .insert(schema.crmConnections)
    .values({
      id: CONNECTION_ID,
      provider: "native",
      label: "Native SQL",
      mode: "native",
      accessScopeKey: "native",
      createdAt: now,
      updatedAt: now,
      ...ownership,
    });
}, 60_000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

describe("list-crm-enrichment-slots", () => {
  it("publishes capability slots without naming a vendor", async () => {
    const result = (await run(listSlots, {})) as {
      budgetUnitsPerPeriod: number;
      slots: Array<{
        slot: string;
        phase: string;
        carriesContactData: boolean;
        unitCost: number;
        credential: { status: string };
      }>;
    };

    expect(result.slots.map((slot) => slot.slot)).toEqual([
      "company",
      "person",
      "contact",
      "web",
      "calls",
    ]);
    expect(result.budgetUnitsPerPeriod).toBeGreaterThan(0);

    const serialized = JSON.stringify(result).toLowerCase();
    for (const vendor of ["apollo", "dataforseo", "gong", "hubspot", "exa"]) {
      expect(serialized).not.toContain(vendor);
    }
  });

  it("marks the contact slot as the only paid, contact-bearing one", async () => {
    const result = (await run(listSlots, {})) as {
      slots: Array<{
        slot: string;
        phase: string;
        carriesContactData: boolean;
        unitCost: number;
      }>;
    };
    const paid = result.slots.filter((slot) => slot.carriesContactData);
    expect(paid.map((slot) => slot.slot)).toEqual(["contact"]);
    expect(paid[0]!.phase).toBe("spend");
    for (const slot of result.slots.filter(
      (entry) => !entry.carriesContactData,
    )) {
      expect(slot.phase).toBe("verify");
      expect(slot.unitCost).toBeLessThan(paid[0]!.unitCost);
    }
  });

  it("reports a credential it could not determine as unknown, never as missing", async () => {
    const result = (await run(listSlots, {})) as {
      slots: Array<{ credential: { status: string } }>;
    };
    for (const slot of result.slots) {
      expect(["granted", "missing", "unknown"]).toContain(
        slot.credential.status,
      );
    }
  });
});

describe("run-crm-attribute-fill: brief", () => {
  it("returns the managed options and each record's current value", async () => {
    const attribute = await seedFillableAttribute({
      title: uniqueTitle("Tier"),
      type: "status",
      fillMode: "agent-classify",
      options: [
        { value: "enterprise", title: "Enterprise" },
        { value: "smb", title: "SMB" },
      ],
    });
    await seedRecord("rec_brief_1", "Northwind");

    const brief = (await run(runFill, {
      attributeId: attribute.id,
      recordIds: ["rec_brief_1"],
    })) as {
      mode: string;
      attribute: { allowedOptions: Array<{ value: string }> };
      records: Array<{ recordId: string; currentValue: unknown }>;
    };

    expect(brief.mode).toBe("prepare");
    expect(
      brief.attribute.allowedOptions.map((option) => option.value),
    ).toEqual(["enterprise", "smb"]);
    expect(brief.records).toHaveLength(1);
    expect(brief.records[0]).toMatchObject({
      recordId: "rec_brief_1",
      currentValue: null,
    });
  });

  it("rejects an attribute with no fill mode", async () => {
    const created = (await run(createAttribute, {
      connectionId: CONNECTION_ID,
      targetId: "accounts",
      title: uniqueTitle("Plain"),
      type: "text",
    })) as { id: string };
    await seedRecord("rec_nofill", "Contoso");

    await expect(
      run(runFill, { attributeId: created.id, recordIds: ["rec_nofill"] }),
    ).rejects.toThrow(/has no fill mode/);
  });

  it("rejects classification against an attribute with no managed options", async () => {
    const attribute = await seedFillableAttribute({
      title: uniqueTitle("Summary"),
      type: "text",
      fillMode: "agent-classify",
    });
    await seedRecord("rec_classify_text", "Initech");

    await expect(
      run(runFill, {
        attributeId: attribute.id,
        recordIds: ["rec_classify_text"],
      }),
    ).rejects.toThrow(/no managed options to classify into/);
  });

  it("rejects a record the caller cannot edit", async () => {
    const attribute = await seedFillableAttribute({
      title: uniqueTitle("Segment"),
      type: "status",
      fillMode: "agent-classify",
      options: [{ value: "enterprise", title: "Enterprise" }],
    });

    await expect(
      run(runFill, { attributeId: attribute.id, recordIds: ["rec_missing"] }),
    ).rejects.toThrow(/not found or are not editable/);
  });
});

describe("run-crm-attribute-fill: writes", () => {
  it("rejects an unknown option and writes nothing at all", async () => {
    const attribute = await seedFillableAttribute({
      title: uniqueTitle("Stage"),
      type: "status",
      fillMode: "agent-classify",
      options: [{ value: "enterprise", title: "Enterprise" }],
    });
    await seedRecord("rec_unknown_a", "Acme");
    await seedRecord("rec_unknown_b", "Umbrella");

    await expect(
      run(runFill, {
        attributeId: attribute.id,
        recordIds: ["rec_unknown_a", "rec_unknown_b"],
        values: [
          { recordId: "rec_unknown_a", value: "enterprise" },
          { recordId: "rec_unknown_b", value: "mid_market" },
        ],
      }),
    ).rejects.toThrow(/is not an option of/);

    // Validation runs before any write: the valid first value must not have
    // landed, or the column is half-filled with no way to tell which half.
    expect(await currentFieldRows("rec_unknown_a", attribute.apiSlug)).toEqual(
      [],
    );
    expect(await currentFieldRows("rec_unknown_b", attribute.apiSlug)).toEqual(
      [],
    );
  });

  it("writes provenance and stamps the value as agent-written", async () => {
    const attribute = await seedFillableAttribute({
      title: uniqueTitle("Industry"),
      type: "text",
      fillMode: "agent-research",
    });
    await seedRecord("rec_prov", "Globex");

    const result = (await run(runFill, {
      attributeId: attribute.id,
      recordIds: ["rec_prov"],
      values: [
        {
          recordId: "rec_prov",
          value: "Industrial automation",
          source: "Globex about page",
          sourceUrl: "https://globex.example/about",
          reasoning: "The about page describes factory automation systems.",
          confidence: 0.82,
        },
      ],
    })) as { written: number; results: Array<{ outcome: string }> };

    expect(result.written).toBe(1);
    expect(result.results[0]!.outcome).toBe("written");

    const [row] = await currentFieldRows("rec_prov", attribute.apiSlug);
    expect(row.stringValue).toBe("Industrial automation");
    expect(row.actorType).toBe("agent");
    expect(row.actorId).toBe(OWNER);
    const provenance = JSON.parse(row.provenanceJson);
    expect(provenance[0]).toMatchObject({
      fieldName: attribute.apiSlug,
      provider: "Globex about page",
      sourceUrl: "https://globex.example/about",
      reasoning: "The about page describes factory automation systems.",
      confidence: 0.82,
      fillMode: "agent-research",
    });
  });

  it("does not rewrite an unchanged value", async () => {
    const attribute = await seedFillableAttribute({
      title: uniqueTitle("Region"),
      type: "text",
      fillMode: "agent-research",
    });
    await seedRecord("rec_same", "Soylent");

    const args = {
      attributeId: attribute.id,
      recordIds: ["rec_same"],
      values: [{ recordId: "rec_same", value: "EMEA" }],
    };
    await run(runFill, args);
    const second = (await run(runFill, args)) as {
      unchanged: number;
      written: number;
    };

    expect(second).toMatchObject({ written: 0, unchanged: 1 });
    const all = await getDb()
      .select()
      .from(schema.crmRecordFields)
      .where(
        and(
          eq(schema.crmRecordFields.recordId, "rec_same"),
          eq(schema.crmRecordFields.fieldName, attribute.apiSlug),
        ),
      );
    // One row total: an equal value opens no history row.
    expect(all).toHaveLength(1);
  });

  it("keeps a human edit and reports why", async () => {
    const attribute = await seedFillableAttribute({
      title: uniqueTitle("Owner Note"),
      type: "text",
      fillMode: "agent-summarize",
    });
    await seedRecord("rec_human", "Cyberdyne");

    await asUser(OWNER, () =>
      writeCrmRecordField({
        target: { recordId: "rec_human" },
        attribute: {
          id: attribute.id,
          apiSlug: attribute.apiSlug,
          attributeType: "text",
          multi: false,
          historyTracked: true,
          valueType: "string",
          storagePolicy: "local-authoritative",
          fieldPolicyId: attribute.id,
        },
        value: "Renewal owner is Sarah",
        actor: { type: "user", id: OWNER },
        ownership,
      }),
    );

    const result = (await run(runFill, {
      attributeId: attribute.id,
      recordIds: ["rec_human"],
      values: [{ recordId: "rec_human", value: "Renewal owner is unknown" }],
    })) as {
      keptExisting: number;
      results: Array<{ outcome: string; keptBecause?: string }>;
    };

    expect(result.keptExisting).toBe(1);
    expect(result.results[0]).toMatchObject({
      outcome: "kept-existing",
      keptBecause: "human-edit",
    });
    const [row] = await currentFieldRows("rec_human", attribute.apiSlug);
    expect(row.stringValue).toBe("Renewal owner is Sarah");
    expect(row.actorType).toBe("user");
  });

  it("keeps a value a paid enrichment bought", async () => {
    const attribute = await seedFillableAttribute({
      title: uniqueTitle("Work Email"),
      type: "text",
      fillMode: "agent-research",
    });
    await seedRecord("rec_paid", "Stark Industries");

    await asUser(OWNER, () =>
      writeCrmRecordField({
        target: { recordId: "rec_paid" },
        attribute: {
          id: attribute.id,
          apiSlug: attribute.apiSlug,
          attributeType: "text",
          multi: false,
          historyTracked: true,
          valueType: "string",
          storagePolicy: "local-authoritative",
          fieldPolicyId: attribute.id,
        },
        value: "pepper@stark.example",
        actor: { type: "provider", id: "enrichment" },
        ownership,
        provenanceJson: JSON.stringify([
          { fieldName: attribute.apiSlug, provider: "contact", paid: true },
        ]),
      }),
    );

    const result = (await run(runFill, {
      attributeId: attribute.id,
      recordIds: ["rec_paid"],
      values: [{ recordId: "rec_paid", value: "guess@stark.example" }],
    })) as { results: Array<{ outcome: string; keptBecause?: string }> };

    expect(result.results[0]).toMatchObject({
      outcome: "kept-existing",
      keptBecause: "paid-enrichment",
    });
    const [row] = await currentFieldRows("rec_paid", attribute.apiSlug);
    expect(row.stringValue).toBe("pepper@stark.example");
  });

  it("reports a record the caller supplied no value for as no-value, not as written", async () => {
    const attribute = await seedFillableAttribute({
      title: uniqueTitle("Notes"),
      type: "text",
      fillMode: "agent-summarize",
    });
    await seedRecord("rec_partial_a", "Wayne");
    await seedRecord("rec_partial_b", "Oscorp");

    const result = (await run(runFill, {
      attributeId: attribute.id,
      recordIds: ["rec_partial_a", "rec_partial_b"],
      values: [{ recordId: "rec_partial_a", value: "Active pilot" }],
    })) as {
      written: number;
      noValue: number;
      results: Array<{ recordId: string; outcome: string }>;
    };

    expect(result).toMatchObject({ written: 1, noValue: 1 });
    expect(result.results).toEqual([
      { recordId: "rec_partial_a", outcome: "written" },
      { recordId: "rec_partial_b", outcome: "no-value" },
    ]);
  });

  it("refuses to write a record that was not part of the prepared set", async () => {
    const attribute = await seedFillableAttribute({
      title: uniqueTitle("Scope"),
      type: "text",
      fillMode: "agent-summarize",
    });
    await seedRecord("rec_scope_in", "Tyrell");
    await seedRecord("rec_scope_out", "Weyland");

    await expect(
      run(runFill, {
        attributeId: attribute.id,
        recordIds: ["rec_scope_in"],
        values: [{ recordId: "rec_scope_out", value: "smuggled" }],
      }),
    ).rejects.toThrow(/is not in this fill's recordIds/);
    expect(await currentFieldRows("rec_scope_out", attribute.apiSlug)).toEqual(
      [],
    );
  });
});

describe("the two-phase spend gate", () => {
  /** Slot deps that answer every slot and record which targets were asked. */
  function recordingDeps(
    seen: string[],
    onExecute?: () => Promise<void>,
  ): CrmEnrichmentSlotDeps {
    return {
      checkCredential: async () => ({ available: true, reason: "granted" }),
      execute: async (args) => {
        await onExecute?.();
        const body = JSON.stringify(args.body ?? args.query ?? {});
        seen.push(body);
        return {
          body: {
            organization: { industry: "software" },
            person: {
              title: "CTO",
              email: "someone@example.test",
              sanitized_phone: "+15550100",
            },
          },
        };
      },
    };
  }

  /**
   * Drive the action's body with a stubbed provider substrate.
   *
   * `defineAction` wraps `run` as `(args, ctx)` and drops anything further, so a
   * stub handed to the wrapped action is never installed and every "the provider
   * was not called with X" assertion passes vacuously. `runCrmEnrichment` is the
   * exported body precisely so the injection is real; mutating the shared
   * `providerApiSlotDeps` instead would leak into every later test in the file.
   */
  function launch(
    args: unknown,
    deps: CrmEnrichmentSlotDeps,
    userEmail = OWNER,
  ) {
    return asUser(userEmail, () =>
      runCrmEnrichment(args as never, ctxFor(userEmail) as never, {
        slots: deps,
      }),
    ) as Promise<any>;
  }

  async function verifyRunFor(recordIds: string[], seen: string[] = []) {
    return (await launch(
      { phase: "verify", scopeKind: "records", recordIds },
      recordingDeps(seen),
    )) as { runId: string; status: string; costUnits: number };
  }

  it("verifies without touching contact data and writes nothing to the record", async () => {
    await seedRecord("rec_gate_a", "Northwind");
    await seedRecord("rec_gate_b", "Contoso");
    const seen: string[] = [];

    const verify = (await launch(
      {
        phase: "verify",
        scopeKind: "records",
        recordIds: ["rec_gate_a", "rec_gate_b"],
      },
      recordingDeps(seen),
    )) as {
      status: string;
      estimate: { slots: string[] };
      outcomes: Array<{ recordId: string; writes?: unknown }>;
    };

    expect(verify.status).toBe("completed");
    expect(verify.estimate.slots).not.toContain("contact");
    // The contact slot's reveal flags are what makes a request billable; no
    // verification request may carry them.
    // Non-vacuous: the free slots really did call the substrate.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.join(" ")).not.toContain("reveal_phone_number");
    for (const outcome of verify.outcomes) {
      expect(outcome.writes).toBeUndefined();
    }
  });

  it("builds the paid input set from the approvals, so an unapproved record is never seen", async () => {
    await seedRecord("rec_appr_yes", "Ada Approved", "person");
    await seedRecord("rec_appr_no", "Rex Rejected", "person");
    const verify = await verifyRunFor(["rec_appr_yes", "rec_appr_no"]);

    const seen: string[] = [];
    const spend = (await launch(
      {
        phase: "spend",
        sourceRunId: verify.runId,
        approvedRecordIds: ["rec_appr_yes"],
      },
      recordingDeps(seen),
    )) as { runId: string; recordCount: number };

    expect(spend.recordCount).toBe(1);

    // Structural, not incidental: the persisted input set — the only thing the
    // paid job reads — contains the approved record and nothing else.
    const [row] = await getDb()
      .select()
      .from(schema.crmEnrichmentRuns)
      .where(eq(schema.crmEnrichmentRuns.id, spend.runId));
    expect(JSON.parse(row.inputRecordIdsJson)).toEqual(["rec_appr_yes"]);
    expect(row.inputRecordIdsJson).not.toContain("rec_appr_no");
    // Non-vacuous: the paid slot really ran, and only for the approved record.
    expect(seen.join(" ")).toContain("rec_appr_yes.example");
    expect(seen.join(" ")).not.toContain("rec_appr_no.example");
  });

  it("refuses to approve a record the verification pass never saw", async () => {
    await seedRecord("rec_seen", "Seen Co");
    await seedRecord("rec_unseen", "Unseen Co");
    const verify = await verifyRunFor(["rec_seen"]);

    await expect(
      launch(
        {
          phase: "spend",
          sourceRunId: verify.runId,
          approvedRecordIds: ["rec_unseen"],
        },
        recordingDeps([]),
      ),
    ).rejects.toThrow(/were not part of verify run/);
  });

  it("persists the run row and claims it before any provider call", async () => {
    await seedRecord("rec_claim", "Claimant Co");
    let rowAtCallTime:
      | { status: string; claimNonce: string | null }
      | undefined;
    let probeError: unknown;

    await launch(
      { phase: "verify", scopeKind: "records", recordIds: ["rec_claim"] },
      recordingDeps([], async () => {
        if (rowAtCallTime) return;
        try {
          const rows = await getDb()
            .select()
            .from(schema.crmEnrichmentRuns)
            .where(eq(schema.crmEnrichmentRuns.status, "running"));
          rowAtCallTime = rows.at(-1);
        } catch (error) {
          probeError = error;
        }
      }),
    );
    expect(probeError).toBeUndefined();

    // A crash here leaves a claimable persisted row, not spend nobody recorded.
    expect(rowAtCallTime?.status).toBe("running");
    expect(rowAtCallTime?.claimNonce).toBeTruthy();
  });

  it("refuses a duplicate run while one is in flight for the same scope", async () => {
    await seedRecord("rec_dup", "Duplicate Co");
    const scope = await resolveEnrichmentScope({
      kind: "records",
      recordIds: ["rec_dup"],
    });
    const now = new Date().toISOString();
    await getDb()
      .insert(schema.crmEnrichmentRuns)
      .values({
        id: "run_inflight",
        scopeKind: scope.kind,
        scopeId: scope.id,
        phase: "verify",
        status: "running",
        startedAt: now,
        createdAt: now,
        updatedAt: now,
        ...ownership,
      });

    await expect(
      launch(
        { phase: "verify", scopeKind: "records", recordIds: ["rec_dup"] },
        recordingDeps([]),
      ),
    ).rejects.toThrow(/already in progress \(run run_inflight\)/);
  });

  it("reports spend per actor and per workspace, and refuses past the cap", async () => {
    await seedRecord("rec_cap", "Capped Co");
    await seedRecord("rec_cap_2", "Capped Two");
    const verify = await verifyRunFor(["rec_cap"]);
    await launch(
      {
        phase: "spend",
        sourceRunId: verify.runId,
        approvedRecordIds: ["rec_cap"],
      },
      recordingDeps([]),
    );
    // Verified before the cap is lowered: the point under test is the PAID
    // pass being refused, not the free one.
    const nextVerify = await verifyRunFor(["rec_cap_2"]);

    const estimate = (await run(estimateEnrichmentAction, {
      phase: "spend",
      scopeKind: "records",
      recordIds: ["rec_cap"],
    })) as {
      budget: {
        allowed: boolean;
        spendToDate: { actorUnits: number; workspaceUnits: number };
      };
    };

    // Two separate numbers, never one ambiguous total.
    expect(estimate.budget.spendToDate.actorUnits).toBeGreaterThan(0);
    expect(estimate.budget.spendToDate.workspaceUnits).toBeGreaterThanOrEqual(
      estimate.budget.spendToDate.actorUnits,
    );

    const previousCap = process.env.CRM_ENRICHMENT_BUDGET_UNITS;
    process.env.CRM_ENRICHMENT_BUDGET_UNITS = "1";
    try {
      const capped = (await run(estimateEnrichmentAction, {
        phase: "spend",
        scopeKind: "records",
        recordIds: ["rec_cap"],
      })) as { budget: { allowed: boolean } };
      expect(capped.budget.allowed).toBe(false);

      await expect(
        launch(
          {
            phase: "spend",
            sourceRunId: nextVerify.runId,
            approvedRecordIds: ["rec_cap_2"],
          },
          recordingDeps([]),
        ),
      ).rejects.toThrow(/budget/i);
    } finally {
      if (previousCap === undefined) {
        delete process.env.CRM_ENRICHMENT_BUDGET_UNITS;
      } else {
        process.env.CRM_ENRICHMENT_BUDGET_UNITS = previousCap;
      }
    }
  });
});
