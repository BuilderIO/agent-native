import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  CrmEnrichmentScopeError,
  actualEnrichmentCost,
  assertNoInFlightRun,
  assertRecordCountWithinCap,
  assertWithinEnrichmentBudget,
  buildPhaseBInput,
  claimEnrichmentRun,
  currentSpendPeriodStart,
  estimateEnrichment,
  evaluateEnrichmentBudget,
  resolveEnrichmentBudgetUnits,
  resolveEnrichmentScope,
  type CrmEnrichmentScope,
  type CrmVerifiedRecord,
} from "../server/lib/enrichment-cost.js";
import {
  CRM_ENRICHMENT_SLOTS,
  runEnrichmentSlots,
  spendSlots,
  verifySlots,
  type CrmEnrichmentPhase,
  type CrmEnrichmentSlot,
  type CrmEnrichmentSlotDeps,
  type CrmEnrichmentSlotOutcome,
  type CrmEnrichmentTarget,
} from "../server/lib/enrichment-slots.js";
import {
  writeCrmRecordField,
  type CrmWritableAttribute,
} from "../server/lib/record-fields.js";
import { parsePersonalName } from "../shared/crm-attributes.js";
import { requireCrmScope, toJson } from "./_crm-action-utils.js";
import {
  legacyValueTypeFor,
  type CrmAttributeRow,
} from "./_crm-attribute-utils.js";
import {
  resolveScopeRecordIds,
  readEnrichmentSpendToDate,
} from "./estimate-crm-enrichment.js";
import { protectedBy, type CurrentFieldRow } from "./run-crm-attribute-fill.js";

/** Ceiling on the stored evidence blob. Past it the run stores summaries only. */
const MAX_OUTCOMES_CHARS = 200_000;

interface RecordOutcome {
  recordId: string;
  slots: CrmEnrichmentSlotOutcome[];
  writes?: FactWrite[];
}

interface FactWrite {
  factKey: string;
  outcome: "written" | "unchanged" | "kept-existing" | "no-attribute";
  keptBecause?: string;
}

export interface RunCrmEnrichmentArgs {
  phase: CrmEnrichmentPhase;
  scopeKind: "object" | "list" | "records";
  targetId?: string;
  recordIds?: string[];
  slots?: CrmEnrichmentSlot[];
  sourceRunId?: string;
  approvedRecordIds?: string[];
}

/** Injectable provider substrate. Production leaves it unset. */
export interface EnrichmentDeps {
  slots?: CrmEnrichmentSlotDeps;
}

export default defineAction({
  description:
    "Run one phase of a gated CRM enrichment. Phase verify is the free evidence pass: it never touches contact data, and its per-record evidence is what a human reviews. Phase spend is the paid pass and requires sourceRunId plus the explicit approvedRecordIds from that review — its input set is BUILT from those approvals, so an unapproved record is never visible to the paid job rather than merely filtered out. Both phases refuse to launch while another run for the same scope and phase is in flight, refuse to pass your period budget, and persist their run row with an atomic claim before any provider call so a crash mid-setup cannot leave a paid job nobody recorded. Values ingested by the paid pass MERGE: a human edit is kept, an unchanged value is not rewritten. Call estimate-crm-enrichment first and quote the cost.",
  schema: z
    .object({
      phase: z.enum(["verify", "spend"]),
      scopeKind: z.enum(["object", "list", "records"]).default("records"),
      targetId: z.string().trim().min(1).max(200).optional(),
      recordIds: z
        .array(z.string().trim().min(1).max(128))
        .max(2000)
        .optional(),
      slots: z.array(z.enum(CRM_ENRICHMENT_SLOTS)).min(1).optional(),
      sourceRunId: z
        .string()
        .trim()
        .min(1)
        .max(128)
        .optional()
        .describe("Phase spend only: the completed verify run being approved."),
      approvedRecordIds: z
        .array(z.string().trim().min(1).max(128))
        .max(2000)
        .optional()
        .describe(
          "Phase spend only: the records the human approved. Nothing else is paid for.",
        ),
    })
    .superRefine((value, ctx) => {
      if (value.phase !== "spend") return;
      if (!value.sourceRunId) {
        ctx.addIssue({
          code: "custom",
          path: ["sourceRunId"],
          message: "Phase spend requires the verify run it is approving.",
        });
      }
      if (!value.approvedRecordIds?.length) {
        ctx.addIssue({
          code: "custom",
          path: ["approvedRecordIds"],
          message:
            "Phase spend requires at least one approved record. The approval gate is not optional.",
        });
      }
    }),
  audit: {
    summary: (args, result) => {
      const run = result as { runId?: string; costUnits?: number };
      return `Ran ${args.phase} CRM enrichment ${run.runId ?? ""} for ${run.costUnits ?? 0} units`;
    },
  },
  run: (args, ctx?: ActionRunContext) => runCrmEnrichment(args, ctx),
});

/**
 * The action body, callable with an injected provider substrate.
 *
 * `defineAction` wraps `run` and forwards only `(args, ctx)`, so an extra
 * parameter on `run` itself is silently dropped. The seam has to live here or
 * every test of the spend gate would have to reach a real provider to run.
 */
export async function runCrmEnrichment(
  args: RunCrmEnrichmentArgs,
  ctx?: ActionRunContext,
  deps?: EnrichmentDeps,
) {
  const ownership = requireCrmScope(ctx);
  const requestedSlots = (args.slots ??
    CRM_ENRICHMENT_SLOTS) as CrmEnrichmentSlot[];

  const plan =
    args.phase === "verify"
      ? await planVerify(args, requestedSlots)
      : await planSpend(args);

  assertRecordCountWithinCap(plan.recordIds.length);
  const estimate = estimateEnrichment({
    phase: args.phase,
    slots: requestedSlots,
    recordCount: plan.recordIds.length,
  });

  const periodStart = currentSpendPeriodStart();
  const budget = evaluateEnrichmentBudget({
    estimatedUnits: estimate.totalCost,
    spendToDate: await readEnrichmentSpendToDate({
      ownerEmail: ownership.ownerEmail,
      periodStart,
    }),
    capUnits: resolveEnrichmentBudgetUnits(),
    periodStart,
  });
  assertWithinEnrichmentBudget(budget);

  const db = getDb();
  // Re-clicking must not create a second paid job for the same scope.
  const inFlight = await db
    .select({ id: schema.crmEnrichmentRuns.id })
    .from(schema.crmEnrichmentRuns)
    .where(
      and(
        eq(schema.crmEnrichmentRuns.scopeKind, plan.scope.kind),
        eq(schema.crmEnrichmentRuns.scopeId, plan.scope.id),
        eq(schema.crmEnrichmentRuns.phase, args.phase),
        inArray(schema.crmEnrichmentRuns.status, ["queued", "running"]),
        accessFilter(schema.crmEnrichmentRuns, schema.crmEnrichmentRunShares),
      ),
    )
    .limit(1);
  assertNoInFlightRun({ scope: plan.scope, phase: args.phase, inFlight });

  // Persisted BEFORE any provider call: a crash between here and the call
  // leaves a claimable row instead of spend nobody recorded. `slots` is the
  // phase's own slot set, and `inputRecordIdsJson` is the frozen input — for
  // phase spend it was constructed from the approvals and contains nothing else.
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  await db.insert(schema.crmEnrichmentRuns).values({
    id: runId,
    scopeKind: plan.scope.kind,
    scopeId: plan.scope.id,
    phase: args.phase,
    status: "queued",
    sourceRunId: args.sourceRunId ?? null,
    slotsJson: toJson(estimate.slots, 2000),
    inputRecordIdsJson: toJson(plan.recordIds, 200_000),
    estimateJson: toJson(estimate, 20_000),
    startedAt,
    createdAt: startedAt,
    updatedAt: startedAt,
    ...ownership,
  });

  const nonce = crypto.randomUUID();
  const won = await claimEnrichmentRun({
    nonce,
    write: async (value) => {
      await db
        .update(schema.crmEnrichmentRuns)
        .set({ claimNonce: value, claimedAt: new Date().toISOString() })
        .where(
          and(
            eq(schema.crmEnrichmentRuns.id, runId),
            eq(schema.crmEnrichmentRuns.status, "queued"),
            accessFilter(
              schema.crmEnrichmentRuns,
              schema.crmEnrichmentRunShares,
              undefined,
              "editor",
            ),
          ),
        );
    },
    readBack: async () => {
      const [row] = await db
        .select({ claimNonce: schema.crmEnrichmentRuns.claimNonce })
        .from(schema.crmEnrichmentRuns)
        .where(eq(schema.crmEnrichmentRuns.id, runId))
        .limit(1);
      return row?.claimNonce ?? null;
    },
  });
  if (!won) {
    // Somebody else owns this row's provider calls. Report it rather than
    // running anyway — a lost claim is exactly what prevents double spend.
    return {
      runId,
      phase: args.phase,
      status: "queued" as const,
      claimed: false,
      estimate,
      budget,
      recordCount: plan.recordIds.length,
      outcomes: [] as RecordOutcome[],
    };
  }

  await db
    .update(schema.crmEnrichmentRuns)
    .set({ status: "running", updatedAt: new Date().toISOString() })
    .where(eq(schema.crmEnrichmentRuns.id, runId));

  const phaseSlots =
    args.phase === "verify"
      ? verifySlots(requestedSlots)
      : spendSlots(requestedSlots);

  const outcomes: RecordOutcome[] = [];
  for (const target of plan.targets) {
    const slotOutcomes = await runEnrichmentSlots({
      slots: phaseSlots,
      target,
      phase: args.phase,
      deps: deps?.slots,
    });
    outcomes.push({
      recordId: target.recordId,
      slots: slotOutcomes,
      // Only the paid pass ingests values; the verify pass produces evidence
      // for a human to approve and writes nothing to the record.
      ...(args.phase === "spend"
        ? {
            writes: await ingestFacts({
              recordId: target.recordId,
              outcomes: slotOutcomes,
              ownership,
              actorId: ctx?.userEmail ?? ownership.ownerEmail,
            }),
          }
        : {}),
    });
  }

  const completedAt = new Date().toISOString();
  const stored = storeableOutcomes(outcomes);
  // Booked from what actually reached a provider, not from the quote: a slot
  // that was unconfigured or skipped cost nothing, and period-to-date spend
  // is summed from this column.
  const costUnits = actualEnrichmentCost(outcomes);
  await db
    .update(schema.crmEnrichmentRuns)
    .set({
      status: "completed",
      outcomesJson: stored.json,
      costUnits,
      completedAt,
      updatedAt: completedAt,
    })
    .where(eq(schema.crmEnrichmentRuns.id, runId));

  return {
    runId,
    phase: args.phase,
    status: "completed" as const,
    claimed: true,
    estimate,
    budget,
    costUnits,
    recordCount: plan.recordIds.length,
    evidenceStored: stored.kind,
    outcomes,
  };
}

interface RunPlan {
  scope: CrmEnrichmentScope;
  readonly recordIds: readonly string[];
  readonly targets: readonly CrmEnrichmentTarget[];
}

async function planVerify(
  args: {
    scopeKind: "object" | "list" | "records";
    targetId?: string;
    recordIds?: string[];
  },
  _slots: CrmEnrichmentSlot[],
): Promise<RunPlan> {
  const recordIds = await resolveScopeRecordIds(args);
  const scope = await resolveEnrichmentScope({
    kind: args.scopeKind,
    targetId: args.targetId,
    recordIds,
  });
  return { scope, recordIds, targets: await loadTargets(recordIds) };
}

/**
 * The paid pass's plan.
 *
 * The input set comes out of `buildPhaseBInput`, which is handed only the
 * approved entries. An id the verify run never saw is refused rather than
 * quietly enriched — an approval has to be an approval OF something.
 */
async function planSpend(args: {
  sourceRunId?: string;
  approvedRecordIds?: string[];
}): Promise<RunPlan> {
  const sourceRunId = args.sourceRunId!;
  const [source] = await getDb()
    .select()
    .from(schema.crmEnrichmentRuns)
    .where(
      and(
        eq(schema.crmEnrichmentRuns.id, sourceRunId),
        accessFilter(schema.crmEnrichmentRuns, schema.crmEnrichmentRunShares),
      ),
    )
    .limit(1);
  if (!source) {
    throw new CrmEnrichmentScopeError(
      "crm-enrichment-source-not-found",
      `Verify run ${sourceRunId} was not found or is not readable by you.`,
    );
  }
  if (source.phase !== "verify" || source.status !== "completed") {
    throw new CrmEnrichmentScopeError(
      "crm-enrichment-source-not-approvable",
      `Run ${sourceRunId} is a ${source.status} ${source.phase} run. Only a completed verify run can be approved for spend.`,
    );
  }

  const verified = parseVerifiedRecords(source.id, source.outcomesJson);
  const verifiedIds = new Set(verified.map((entry) => entry.recordId));
  const approved = new Set(args.approvedRecordIds ?? []);
  const unverified = [...approved].filter((id) => !verifiedIds.has(id));
  if (unverified.length > 0) {
    throw new CrmEnrichmentScopeError(
      "crm-enrichment-approval-unverified",
      `These records were not part of verify run ${sourceRunId}, so they cannot be approved from it: ${unverified.join(", ")}.`,
    );
  }

  const targets = await loadTargets([...approved]);
  const entries: CrmVerifiedRecord[] = verified.map((entry) => ({
    target: targets.find((target) => target.recordId === entry.recordId)!,
    outcomes: [],
    approved: approved.has(entry.recordId),
  }));
  const input = buildPhaseBInput(entries.filter((entry) => entry.target));
  if (input.recordIds.length === 0) {
    throw new CrmEnrichmentScopeError(
      "crm-enrichment-approval-empty",
      `None of the approved records of verify run ${sourceRunId} are readable by you.`,
    );
  }
  return {
    scope: { kind: source.scopeKind, id: source.scopeId },
    recordIds: input.recordIds,
    targets: input.targets,
  };
}

/** Record ids the verify run actually produced evidence for. */
function parseVerifiedRecords(
  runId: string,
  outcomesJson: string,
): Array<{ recordId: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(outcomesJson);
  } catch {
    throw new CrmEnrichmentScopeError(
      "crm-enrichment-source-unreadable",
      `Verify run ${runId} has unreadable evidence, so its approvals cannot be checked. Re-run the verification.`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new CrmEnrichmentScopeError(
      "crm-enrichment-source-unreadable",
      `Verify run ${runId} stored no reviewable evidence. Re-run the verification.`,
    );
  }
  return parsed.flatMap((entry) =>
    entry &&
    typeof entry === "object" &&
    typeof (entry as Record<string, unknown>).recordId === "string"
      ? [{ recordId: (entry as { recordId: string }).recordId }]
      : [],
  );
}

async function loadTargets(
  recordIds: string[],
): Promise<CrmEnrichmentTarget[]> {
  if (recordIds.length === 0) return [];
  const rows = await getDb()
    .select({
      id: schema.crmRecords.id,
      displayName: schema.crmRecords.displayName,
      domain: schema.crmRecords.domain,
      kind: schema.crmRecords.kind,
    })
    .from(schema.crmRecords)
    .where(
      and(
        inArray(schema.crmRecords.id, recordIds),
        eq(schema.crmRecords.tombstone, false),
        accessFilter(schema.crmRecords, schema.crmRecordShares),
      ),
    );
  return rows.map((row) => {
    const name =
      row.kind === "person"
        ? parsePersonalName(row.displayName)
        : { status: "absent" as const };
    return {
      recordId: row.id,
      displayName: row.displayName,
      domain: row.domain,
      firstName: name.status === "parsed" ? name.first : null,
      lastName: name.status === "parsed" ? name.last : null,
      companyName: row.kind === "person" ? null : row.displayName,
    };
  });
}

/**
 * Merge a record's bought facts into its attributes.
 *
 * A fact lands on the attribute whose api slug matches its key. Merge, never
 * upsert: a value a human edited is kept and reported as such, an unchanged
 * value is not rewritten (which is what keeps bitemporal history from
 * exploding), and a fact with no matching attribute is reported as
 * `no-attribute` rather than dropped.
 */
async function ingestFacts(input: {
  recordId: string;
  outcomes: CrmEnrichmentSlotOutcome[];
  ownership: {
    ownerEmail: string;
    orgId: string | null;
    visibility: "private" | "org";
  };
  actorId: string;
}): Promise<FactWrite[]> {
  const facts = input.outcomes.flatMap((outcome) =>
    outcome.status === "ok" ? outcome.facts : [],
  );
  if (facts.length === 0) return [];

  const db = getDb();
  const slugs = [...new Set(facts.map((fact) => fact.key))];
  const attributeRows = (await db
    .select()
    .from(schema.crmFieldPolicies)
    .where(
      and(
        inArray(schema.crmFieldPolicies.fieldName, slugs),
        eq(schema.crmFieldPolicies.archived, false),
        accessFilter(
          schema.crmFieldPolicies,
          schema.crmFieldPolicyShares,
          undefined,
          "editor",
        ),
      ),
    )) as CrmAttributeRow[];
  const bySlug = new Map(
    attributeRows.map((row) => [row.apiSlug ?? row.fieldName, row]),
  );

  const current = await loadCurrentFieldRows(input.recordId, slugs);
  const now = new Date().toISOString();
  const writes: FactWrite[] = [];

  for (const fact of facts) {
    const row = bySlug.get(fact.key);
    if (!row || !isLocallyStored(row)) {
      writes.push({ factKey: fact.key, outcome: "no-attribute" });
      continue;
    }
    const existing = current.get(row.apiSlug ?? row.fieldName);
    const kept = existing ? protectedBy(existing) : null;
    if (kept === "human-edit") {
      writes.push({
        factKey: fact.key,
        outcome: "kept-existing",
        keptBecause: kept,
      });
      continue;
    }

    const attribute: CrmWritableAttribute = {
      id: row.id,
      apiSlug: row.apiSlug ?? row.fieldName,
      attributeType: row.attributeType,
      multi: row.multi,
      historyTracked: row.historyTracked,
      valueType: legacyValueTypeFor(row.attributeType, row.multi),
      storagePolicy: row.storagePolicy as
        | "mirrored"
        | "derived-local"
        | "local-authoritative",
      fieldPolicyId: row.id,
    };
    const result = await writeCrmRecordField({
      target: { recordId: input.recordId },
      attribute,
      value: fact.value,
      // A provider bought this value; the agent only routed it.
      actor: { type: "provider", id: input.actorId },
      ownership: input.ownership,
      provenanceJson: toJson(
        [
          {
            fieldName: attribute.apiSlug,
            provider: "enrichment",
            // What makes a later free fill keep this value instead of clobbering it.
            paid: true,
            ...(fact.sourceUrl ? { sourceUrl: fact.sourceUrl } : {}),
            observedAt: now,
          },
        ],
        4000,
      ),
      now,
    });
    writes.push({
      factKey: fact.key,
      outcome: result.changed ? "written" : "unchanged",
    });
  }
  return writes;
}

function isLocallyStored(row: CrmAttributeRow): boolean {
  return (
    row.storagePolicy === "mirrored" ||
    row.storagePolicy === "derived-local" ||
    row.storagePolicy === "local-authoritative"
  );
}

async function loadCurrentFieldRows(recordId: string, slugs: string[]) {
  const rows = await getDb()
    .select({
      recordId: schema.crmRecordFields.recordId,
      fieldName: schema.crmRecordFields.fieldName,
      stringValue: schema.crmRecordFields.stringValue,
      numberValue: schema.crmRecordFields.numberValue,
      booleanValue: schema.crmRecordFields.booleanValue,
      jsonValue: schema.crmRecordFields.jsonValue,
      actorType: schema.crmRecordFields.actorType,
      provenanceJson: schema.crmRecordFields.provenanceJson,
    })
    .from(schema.crmRecordFields)
    .where(
      and(
        eq(schema.crmRecordFields.recordId, recordId),
        inArray(schema.crmRecordFields.fieldName, slugs),
        accessFilter(schema.crmRecordFields, schema.crmRecordFieldShares),
      ),
    );
  return new Map<string, CurrentFieldRow>(
    rows
      .filter((row) => row.provenanceJson !== null)
      .map((row) => [row.fieldName, row as CurrentFieldRow]),
  );
}

/**
 * The evidence blob to persist.
 *
 * A run over thousands of records can produce more evidence than belongs in a
 * text column. Past the ceiling it stores per-record STATUS COUNTS and says so
 * with `kind: "summary-only"` — a visible, different value. It never silently
 * truncates, and it never fails a run whose money is already spent.
 */
function storeableOutcomes(outcomes: RecordOutcome[]): {
  json: string;
  kind: "full" | "summary-only";
} {
  const full = JSON.stringify(outcomes);
  if (full.length <= MAX_OUTCOMES_CHARS) return { json: full, kind: "full" };
  const summary = outcomes.map((outcome) => ({
    recordId: outcome.recordId,
    evidence: "summary-only",
    slots: outcome.slots.map((slot) => ({
      slot: slot.slot,
      status: slot.status,
      ...(slot.status === "error" ? { error: slot.error } : {}),
    })),
    ...(outcome.writes ? { writes: outcome.writes } : {}),
  }));
  return { json: JSON.stringify(summary), kind: "summary-only" };
}
