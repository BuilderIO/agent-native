/**
 * The enrichment spend gate: what a run will cost, what has been spent this
 * period, whether the cap allows it, and whether the run may launch at all.
 *
 * Costs are provider-neutral "units", not any vendor's credits — a slot rebound
 * to a different provider changes its unit price here and nowhere else.
 *
 * Two things this fixes relative to the app it was ported from:
 *   - period-to-date is reported per ACTOR and per WORKSPACE as two separate
 *     numbers. One number labelled ambiguously reads as personal spend while
 *     actually summing the whole org, and users budget against it.
 *   - there is a cap, and passing it refuses the run. Refusing to spend is a
 *     feature; an estimate nobody enforces is decoration.
 */

import {
  spendSlots,
  verifySlots,
  type CrmEnrichmentPhase,
  type CrmEnrichmentSlot,
  type CrmEnrichmentSlotOutcome,
  type CrmEnrichmentTarget,
} from "./enrichment-slots.js";

/** Units one record costs in one slot. Phase A slots are the cheap ones. */
export const CRM_ENRICHMENT_SLOT_UNIT_COST: Record<CrmEnrichmentSlot, number> =
  {
    company: 1,
    person: 1,
    // The reveal pass. An order of magnitude above verification is the whole
    // reason the approval gate sits between them.
    contact: 10,
    web: 2,
    calls: 0,
  };

/** Units per actor per calendar month before a run is refused. */
export const CRM_DEFAULT_ENRICHMENT_BUDGET_UNITS = 500;

const BUDGET_ENV_KEY = "CRM_ENRICHMENT_BUDGET_UNITS";

/** A spend the caller must change before retrying — surfaces as HTTP 422. */
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
  /** The slots this phase will actually run — not the slots asked for. */
  slots: CrmEnrichmentSlot[];
  lineItems: CrmEnrichmentLineItem[];
  totalCost: number;
}

/**
 * Line-item cost for one phase.
 *
 * The slot set is derived from the phase, not taken on trust, so an estimate can
 * never quote a cheap verification pass for a run that will buy contact data.
 */
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

/** Start of the calendar month a timestamp falls in, in UTC. */
export function currentSpendPeriodStart(now: Date = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();
}

/**
 * The configured cap.
 *
 * An unreadable override throws instead of falling back to the default: a typo
 * in the env var must not silently restore a cap the operator meant to lower.
 */
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
  /** Spend attributed to the calling actor. This is the one the cap applies to. */
  actorUnits: number;
  /** Spend across every actor whose runs the caller can see. Context, not a cap. */
  workspaceUnits: number;
}

export interface CrmBudgetDecision {
  allowed: boolean;
  capUnits: number;
  periodStart: string;
  spendToDate: CrmSpendToDate;
  estimatedUnits: number;
  /** Units left for this actor after the run. Negative when it would overrun. */
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

/** Throw the typed 422 unless the decision allows the spend. */
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

// ---------------------------------------------------------------------------
// The launch gate
// ---------------------------------------------------------------------------

/**
 * Hard ceiling on the records one run may touch.
 *
 * `input_record_ids_json` is a text column, and an unbounded id array in it
 * erodes the no-payloads-in-SQL rule one row at a time. Exceeding this is a
 * typed refusal, never a silent slice — a truncated run is not a completed one.
 */
export const MAX_ENRICHMENT_RECORDS_PER_RUN = 2000;

export type CrmEnrichmentScopeKind = "object" | "list" | "records";

export interface CrmEnrichmentScope {
  kind: CrmEnrichmentScopeKind;
  id: string;
}

/** A launch the caller must change before retrying — surfaces as HTTP 409. */
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

/** Refuse to launch while another run for the same scope and phase is live. */
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

/** One record's result from the free verification pass, plus the human verdict. */
export interface CrmVerifiedRecord {
  target: CrmEnrichmentTarget;
  outcomes: CrmEnrichmentSlotOutcome[];
  approved: boolean;
}

/**
 * The input set for the paid pass.
 *
 * Frozen, and readonly in the type, because this value IS the spend bound. A
 * caller that could push one more target into it after the approval gate would
 * have turned a structural guarantee back into a convention.
 */
export interface CrmPhaseBInput {
  readonly recordIds: readonly string[];
  readonly targets: readonly CrmEnrichmentTarget[];
}

/**
 * Build the paid pass's input set from the approvals.
 *
 * The result is the ONLY thing phase B is handed, and it is constructed from
 * approved entries rather than filtered from all of them. An unapproved record
 * is not excluded by a condition somebody could later invert — it was never
 * placed in the set to begin with.
 */
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

/**
 * Win or lose the right to make this run's provider calls.
 *
 * Write a unique nonce, read it back, proceed only as the winner. The run row
 * is persisted before any provider call, so a crash between insert and call
 * leaves a claimable row rather than a paid job nobody recorded. A read-back
 * that does not match means another worker won; returning false is the point,
 * not a failure.
 */
export async function claimEnrichmentRun(input: {
  nonce: string;
  write(nonce: string): Promise<void>;
  readBack(): Promise<string | null>;
}): Promise<boolean> {
  await input.write(input.nonce);
  return (await input.readBack()) === input.nonce;
}
