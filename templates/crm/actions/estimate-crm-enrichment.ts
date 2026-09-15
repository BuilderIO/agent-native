import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  CrmEnrichmentScopeError,
  MAX_ENRICHMENT_RECORDS_PER_RUN,
  assertRecordCountWithinCap,
  currentSpendPeriodStart,
  estimateEnrichment,
  evaluateEnrichmentBudget,
  resolveEnrichmentBudgetUnits,
  resolveEnrichmentScope,
  type CrmEnrichmentScopeKind,
  type CrmSpendToDate,
} from "../server/lib/enrichment-cost.js";
import {
  CRM_ENRICHMENT_SLOTS,
  type CrmEnrichmentSlot,
} from "../server/lib/enrichment-slots.js";
import { requireCrmScope } from "./_crm-action-utils.js";

export const scopeInput = {
  scopeKind: z.enum(["object", "list", "records"]).default("records"),
  targetId: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe("Object type for scopeKind=object, list id for scopeKind=list."),
  recordIds: z
    .array(z.string().trim().min(1).max(128))
    .max(MAX_ENRICHMENT_RECORDS_PER_RUN)
    .optional()
    .describe("Required for scopeKind=records."),
  slots: z
    .array(z.enum(CRM_ENRICHMENT_SLOTS))
    .min(1)
    .optional()
    .describe("Defaults to every slot. The phase decides which of them run."),
};

export default defineAction({
  description:
    "Estimate what an enrichment run will cost BEFORE spending anything, with a per-slot line-item breakdown and your period-to-date spend. Read-only: it starts nothing. Phase verify prices the free evidence pass; phase spend prices the paid contact pass over the records you intend to approve. Spend to date is reported twice — actorUnits is yours and is what the budget cap applies to, workspaceUnits is everyone's and is context only. Quote the estimate to the user before calling run-crm-enrichment, which echoes back this same estimate.",
  schema: z.object({
    phase: z.enum(["verify", "spend"]),
    ...scopeInput,
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args, ctx?: ActionRunContext) => {
    const ownership = requireCrmScope(ctx);
    const recordIds = await resolveScopeRecordIds(args);
    assertRecordCountWithinCap(recordIds.length);
    const scope = await resolveEnrichmentScope({
      kind: args.scopeKind,
      targetId: args.targetId,
      recordIds,
    });

    const estimate = estimateEnrichment({
      phase: args.phase,
      slots: (args.slots ?? CRM_ENRICHMENT_SLOTS) as CrmEnrichmentSlot[],
      recordCount: recordIds.length,
    });

    const periodStart = currentSpendPeriodStart();
    const spendToDate = await readEnrichmentSpendToDate({
      ownerEmail: ownership.ownerEmail,
      periodStart,
    });
    const budget = evaluateEnrichmentBudget({
      estimatedUnits: estimate.totalCost,
      spendToDate,
      capUnits: resolveEnrichmentBudgetUnits(),
      periodStart,
    });

    return { scope, recordCount: recordIds.length, estimate, budget };
  },
});

/**
 * The records a scope resolves to, access-scoped.
 *
 * An explicit record id that does not resolve is an error, not a silent
 * omission: quoting a price for four records when the user named five is a
 * quote for a different job.
 */
export async function resolveScopeRecordIds(args: {
  scopeKind: CrmEnrichmentScopeKind;
  targetId?: string;
  recordIds?: string[];
}): Promise<string[]> {
  const db = getDb();
  if (args.scopeKind === "records") {
    const requested = [...new Set(args.recordIds ?? [])];
    if (requested.length === 0) {
      throw new CrmEnrichmentScopeError(
        "crm-enrichment-scope-empty",
        "scopeKind=records needs at least one record id.",
      );
    }
    const rows = await db
      .select({ id: schema.crmRecords.id })
      .from(schema.crmRecords)
      .where(
        and(
          inArray(schema.crmRecords.id, requested),
          eq(schema.crmRecords.tombstone, false),
          accessFilter(schema.crmRecords, schema.crmRecordShares),
        ),
      );
    const found = new Set(rows.map((row) => row.id));
    const missing = requested.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new CrmEnrichmentScopeError(
        "crm-enrichment-scope-record-not-readable",
        `These CRM records were not found or are not readable by you: ${missing.join(", ")}.`,
      );
    }
    return requested;
  }

  if (args.scopeKind === "list") {
    if (!args.targetId) {
      throw new CrmEnrichmentScopeError(
        "crm-enrichment-scope-target-required",
        "scopeKind=list needs a targetId.",
      );
    }
    const rows = await db
      .select({ recordId: schema.crmListEntries.recordId })
      .from(schema.crmListEntries)
      .where(
        and(
          eq(schema.crmListEntries.listId, args.targetId),
          accessFilter(schema.crmListEntries, schema.crmListEntryShares),
        ),
      )
      .limit(MAX_ENRICHMENT_RECORDS_PER_RUN + 1);
    // A record may hold several entries in one list; it is still one record to enrich.
    return [...new Set(rows.map((row) => row.recordId))];
  }

  if (!args.targetId) {
    throw new CrmEnrichmentScopeError(
      "crm-enrichment-scope-target-required",
      "scopeKind=object needs a targetId.",
    );
  }
  const rows = await db
    .select({ id: schema.crmRecords.id })
    .from(schema.crmRecords)
    .where(
      and(
        eq(schema.crmRecords.objectType, args.targetId),
        eq(schema.crmRecords.tombstone, false),
        accessFilter(schema.crmRecords, schema.crmRecordShares),
      ),
    )
    .limit(MAX_ENRICHMENT_RECORDS_PER_RUN + 1);
  return rows.map((row) => row.id);
}

/**
 * Spend since the period start, per actor and across the workspace.
 *
 * A run still in flight counts at its estimate, not at zero: otherwise ten
 * concurrent launches all see the same pre-spend total and every one of them
 * passes a cap they collectively blow through.
 */
export async function readEnrichmentSpendToDate(input: {
  ownerEmail: string;
  periodStart: string;
}): Promise<CrmSpendToDate> {
  const rows = await getDb()
    .select({
      id: schema.crmEnrichmentRuns.id,
      ownerEmail: schema.crmEnrichmentRuns.ownerEmail,
      status: schema.crmEnrichmentRuns.status,
      costUnits: schema.crmEnrichmentRuns.costUnits,
      estimateJson: schema.crmEnrichmentRuns.estimateJson,
    })
    .from(schema.crmEnrichmentRuns)
    .where(
      and(
        gte(schema.crmEnrichmentRuns.startedAt, input.periodStart),
        accessFilter(schema.crmEnrichmentRuns, schema.crmEnrichmentRunShares),
      ),
    );

  let actorUnits = 0;
  let workspaceUnits = 0;
  for (const row of rows) {
    if (row.status === "failed") continue;
    const units = row.costUnits ?? estimatedUnitsOf(row.id, row.estimateJson);
    workspaceUnits += units;
    if (row.ownerEmail === input.ownerEmail) actorUnits += units;
  }
  return { actorUnits, workspaceUnits };
}

/** An unreadable estimate throws — an unknown cost must not be counted as zero. */
function estimatedUnitsOf(runId: string, estimateJson: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(estimateJson);
  } catch {
    throw new Error(
      `Enrichment run ${runId} has an unreadable estimate_json, so period-to-date spend cannot be totalled. Repair or fail the run.`,
    );
  }
  const total =
    parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>).totalCost
      : undefined;
  if (total === undefined || total === null) return 0;
  if (typeof total !== "number" || !Number.isFinite(total)) {
    throw new Error(
      `Enrichment run ${runId} has a non-numeric estimate total, so period-to-date spend cannot be totalled.`,
    );
  }
  return total;
}
