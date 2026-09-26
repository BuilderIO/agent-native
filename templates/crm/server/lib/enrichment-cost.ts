
import {
  spendSlots,
  verifySlots,
  type CrmEnrichmentPhase,
  type CrmEnrichmentSlot,
  type CrmEnrichmentSlotOutcome,
  type CrmEnrichmentTarget,
} from "./enrichment-slots.js";

export const CRM_ENRICHMENT_SLOT_UNIT_COST: Record<CrmEnrichmentSlot, number> =
  {
    company: 1,
    person: 1,
    contact: 10,
    web: 2,
    calls: 0,
  };

export const CRM_DEFAULT_ENRICHMENT_BUDGET_UNITS = 500;

const BUDGET_ENV_KEY = "CRM_ENRICHMENT_BUDGET_UNITS";

export class CrmEnrichmentBudgetError extends Error {
  readonly statusCode = 422;
  readonly code: string;
  readonly decision: CrmBudgetDecision;

  constructor(code: string, message: string, decision: CrmBudgetDecision) {
    super(message);
    this.name = "CrmEnrichmentBudgetError";
    this.code = code;
    this.decision = decision;
  }
}

export interface CrmEnrichmentLineItem {
  slot: CrmEnrichmentSlot;
  recordCount: number;
  unitCost: number;
  cost: number;
}

export interface CrmEnrichmentEstimate {
  phase: CrmEnrichmentPhase;
  recordCount: number;
  slots: CrmEnrichmentSlot[];
  lineItems: CrmEnrichmentLineItem[];
  totalCost: number;
}

export function estimateEnrichment(input: {
  phase: CrmEnrichmentPhase;
  slots: readonly CrmEnrichmentSlot[];
  recordCount: number;
}): CrmEnrichmentEstimate {
  const slots =
    input.phase === "verify"
      ? verifySlots(input.slots)
      : spendSlots(input.slots);
  const lineItems = slots.map((slot) => {
    const unitCost = CRM_ENRICHMENT_SLOT_UNIT_COST[slot];
    return {
      slot,
      recordCount: input.recordCount,
      unitCost,
      cost: unitCost * input.recordCount,
    };
  });
  return {
    phase: input.phase,
    recordCount: input.recordCount,
    slots,
    lineItems,
    totalCost: lineItems.reduce((sum, item) => sum + item.cost, 0),
  };
}

/**
 * What a finished run actually cost, from its outcomes rather than its quote.
 *
 * Only a slot that reached the provider is billable. An `unconfigured` or
 * `skipped` slot made no call at all, so booking the quoted price for it would
 * record spend that never happened — and period-to-date is summed from these
 * numbers, so that error compounds into a budget nobody can reconcile.
 *
 * ponytail: an `error` outcome counts as free. True for a request that never
 * completed, optimistic for a provider that bills a rejected call; if one does,
 * bill errors here rather than at the call site.
 */
export function actualEnrichmentCost(
  outcomes: ReadonlyArray<{ slots: readonly CrmEnrichmentSlotOutcome[] }>,
): number {
  let total = 0;
  for (const record of outcomes) {
    for (const slot of record.slots) {
      if (slot.status !== "ok" && slot.status !== "empty") continue;
      total += CRM_ENRICHMENT_SLOT_UNIT_COST[slot.slot];
    }
  }
  return total;
}

export function currentSpendPeriodStart(now: Date = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();
}

export function resolveEnrichmentBudgetUnits(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env[BUDGET_ENV_KEY];
  if (raw === undefined || raw.trim() === "") {
    return CRM_DEFAULT_ENRICHMENT_BUDGET_UNITS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(
      `${BUDGET_ENV_KEY} must be a non-negative number of units; it is "${raw}".`,
    );
  }
  return parsed;
}

export interface CrmSpendToDate {
  actorUnits: number;
  workspaceUnits: number;
}

export interface CrmBudgetDecision {
  allowed: boolean;
  capUnits: number;
  periodStart: string;
  spendToDate: CrmSpendToDate;
  estimatedUnits: number;
  remainingUnits: number;
  reason?: string;
}

export function evaluateEnrichmentBudget(input: {
  estimatedUnits: number;
  spendToDate: CrmSpendToDate;
  capUnits: number;
  periodStart: string;
}): CrmBudgetDecision {
  const remainingUnits =
    input.capUnits - input.spendToDate.actorUnits - input.estimatedUnits;
  const allowed = remainingUnits >= 0;
  return {
    allowed,
    capUnits: input.capUnits,
    periodStart: input.periodStart,
    spendToDate: input.spendToDate,
    estimatedUnits: input.estimatedUnits,
    remainingUnits,
    ...(allowed
      ? {}
      : {
          reason: `This run costs ${input.estimatedUnits} units. You have spent ${input.spendToDate.actorUnits} of your ${input.capUnits}-unit budget since ${input.periodStart}, which leaves ${Math.max(
            0,
            input.capUnits - input.spendToDate.actorUnits,
          )}. Approve fewer records or raise ${BUDGET_ENV_KEY}.`,
        }),
  };
}

export function assertWithinEnrichmentBudget(
  decision: CrmBudgetDecision,
): void {
  if (decision.allowed) return;
  throw new CrmEnrichmentBudgetError(
    "crm-enrichment-budget-exceeded",
    decision.reason ?? "This run exceeds the enrichment budget.",
    decision,
  );
}


export const MAX_ENRICHMENT_RECORDS_PER_RUN = 2000;

export type CrmEnrichmentScopeKind = "object" | "list" | "records";

export interface CrmEnrichmentScope {
  kind: CrmEnrichmentScopeKind;
  id: string;
}

export class CrmEnrichmentRunConflictError extends Error {
  readonly statusCode = 409;
  readonly code = "crm-enrichment-run-in-flight";
  readonly runId: string;

  constructor(message: string, runId: string) {
    super(message);
    this.name = "CrmEnrichmentRunConflictError";
    this.runId = runId;
  }
}

/** A scope this run cannot be launched over — surfaces as HTTP 422. */
export class CrmEnrichmentScopeError extends Error {
  readonly statusCode = 422;
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CrmEnrichmentScopeError";
    this.code = code;
  }
}

export function assertRecordCountWithinCap(count: number): void {
  if (count <= MAX_ENRICHMENT_RECORDS_PER_RUN) return;
  throw new CrmEnrichmentScopeError(
    "crm-enrichment-scope-too-large",
    `This run would touch ${count} records; the cap is ${MAX_ENRICHMENT_RECORDS_PER_RUN}. Narrow the scope and run it again.`,
  );
}

/**
 * The scope an in-flight run is compared against.
 *
 * An ad-hoc record set has no natural id, so it gets a deterministic digest of
 * its sorted record ids. Two identical ad-hoc launches therefore collide (which
 * is the point — the second is a double-click), and two different ones do not.
 */
export async function resolveEnrichmentScope(input: {
  kind: CrmEnrichmentScopeKind;
  targetId?: string | null;
  recordIds: readonly string[];
}): Promise<CrmEnrichmentScope> {
  if (input.kind !== "records") {
    const id = input.targetId?.trim();
    if (!id) {
      throw new CrmEnrichmentScopeError(
        "crm-enrichment-scope-target-required",
        `A ${input.kind} scope needs a targetId.`,
      );
    }
    return { kind: input.kind, id };
  }
  const canonical = [...new Set(input.recordIds)].sort().join("\u0000");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return {
    kind: "records",
    id: `sha256:${Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    )
      .join("")
      .slice(0, 32)}`,
  };
}

export function enrichmentScopeKey(scope: CrmEnrichmentScope): string {
  return `${scope.kind}:${scope.id}`;
}

export function assertNoInFlightRun(input: {
  scope: CrmEnrichmentScope;
  phase: CrmEnrichmentPhase;
  inFlight: ReadonlyArray<{ id: string }>;
}): void {
  const existing = input.inFlight[0];
  if (!existing) return;
  throw new CrmEnrichmentRunConflictError(
    `A ${input.phase} enrichment run for ${enrichmentScopeKey(input.scope)} is already in progress (run ${existing.id}). Wait for it to finish before starting another.`,
    existing.id,
  );
}

export interface CrmVerifiedRecord {
  target: CrmEnrichmentTarget;
  outcomes: CrmEnrichmentSlotOutcome[];
  approved: boolean;
}

export interface CrmPhaseBInput {
  readonly recordIds: readonly string[];
  readonly targets: readonly CrmEnrichmentTarget[];
}

export function buildPhaseBInput(
  verified: readonly CrmVerifiedRecord[],
): CrmPhaseBInput {
  const targets: CrmEnrichmentTarget[] = [];
  for (const entry of verified) {
    if (!entry.approved) continue;
    targets.push(entry.target);
  }
  return Object.freeze({
    recordIds: Object.freeze(targets.map((target) => target.recordId)),
    targets: Object.freeze(targets),
  });
}

export async function claimEnrichmentRun(input: {
  nonce: string;
  write(nonce: string): Promise<void>;
  readBack(): Promise<string | null>;
}): Promise<boolean> {
  await input.write(input.nonce);
  return (await input.readBack()) === input.nonce;
}
