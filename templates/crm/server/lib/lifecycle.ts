/**
 * The one path a CRM `status` attribute value may be changed through.
 *
 * A status is not just another typed value: stages drive SLAs, boards, pipeline
 * reporting, and celebration, so a blind status write is how a record silently
 * re-enters a stage it already left, or lands in a retired one that no board
 * column renders. The rules below are therefore stated as NAMED SETS with the
 * reason each one exists, and every blocked case answers with a sentence a
 * person can act on rather than a boolean the caller has to re-interpret.
 *
 * The allowed values come from the attribute's `crm_attribute_options` rows, not
 * from an enum in this file — a workspace renames and retires its own stages.
 *
 * Two properties are load-bearing and easy to lose in a refactor:
 *
 * 1. Bulk transitions PARTITION by eligibility. An ineligible target is
 *    reported, never quietly written and never quietly dropped.
 * 2. The observed `from` values are re-asserted in the claim query's WHERE
 *    clause, so a status that moved between the partition read and the write is
 *    left alone instead of being clobbered by a decision made about stale state.
 */

import { accessFilter } from "@agent-native/core/sharing";
import { and, eq, inArray, isNull, or, type SQL } from "drizzle-orm";

import type { CrmActorType } from "../../shared/crm-contract.js";
import { schema } from "../db/index.js";
import {
  CrmAttributeValueError,
  writeCrmRecordField,
  type CrmFieldWriteDb,
  type CrmWritableAttribute,
} from "./record-fields.js";

/** Most targets one bulk transition may carry. */
export const MAX_STATUS_TRANSITION_TARGETS = 200;

/**
 * A lifecycle problem the caller must fix before retrying. Shares the attribute
 * writer's 422 contract so every "your input is wrong" failure out of the CRM
 * write path looks the same to an HTTP, MCP, or agent caller.
 */
export class CrmLifecycleError extends CrmAttributeValueError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "CrmLifecycleError";
  }
}

export interface CrmStatusOption {
  value: string;
  title: string;
  position: number;
  archived: boolean;
  celebrate: boolean;
  targetDays: number | null;
}

export interface CrmStatusAttribute extends CrmWritableAttribute {
  label: string;
  authority: "provider" | "derived-local" | "local-authoritative";
  archived: boolean;
}

export interface CrmLifecycle {
  attribute: CrmStatusAttribute;
  /** Every declared option, board order first. */
  options: CrmStatusOption[];
  /** Options a value may move INTO. */
  enterableValues: string[];
  /** Every declared value, archived included — what a stored value may be. */
  knownValues: string[];
}

/** Why one target was not transitioned. Stable codes; sentences are for humans. */
export type CrmStatusBlockCode =
  | "attribute-archived"
  | "provider-authority"
  | "record-tombstoned"
  | "unknown-status"
  | "archived-status"
  | "concurrent-transition";

export interface CrmStatusBlock {
  code: CrmStatusBlockCode;
  message: string;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Load one status attribute and its options.
 *
 * A non-`status` attribute is a caller bug, not a blocked transition: the
 * lifecycle governs stages, and routing an ordinary text field through it would
 * silently gain rules nothing declared.
 */
export async function loadCrmStatusLifecycle(
  db: CrmFieldWriteDb,
  attributeId: string,
): Promise<CrmLifecycle> {
  const [row] = await db
    .select({
      id: schema.crmFieldPolicies.id,
      apiSlug: schema.crmFieldPolicies.apiSlug,
      fieldName: schema.crmFieldPolicies.fieldName,
      label: schema.crmFieldPolicies.label,
      attributeType: schema.crmFieldPolicies.attributeType,
      multi: schema.crmFieldPolicies.multi,
      historyTracked: schema.crmFieldPolicies.historyTracked,
      valueType: schema.crmFieldPolicies.valueType,
      storagePolicy: schema.crmFieldPolicies.storagePolicy,
      authority: schema.crmFieldPolicies.authority,
      archived: schema.crmFieldPolicies.archived,
    })
    .from(schema.crmFieldPolicies)
    .where(
      and(
        eq(schema.crmFieldPolicies.id, attributeId),
        accessFilter(schema.crmFieldPolicies, schema.crmFieldPolicyShares),
      ),
    )
    .limit(1);

  if (!row) {
    throw new CrmLifecycleError(
      "crm-status-attribute-not-found",
      `CRM attribute "${attributeId}" was not found or you cannot see it.`,
    );
  }
  if (row.attributeType !== "status") {
    throw new CrmLifecycleError(
      "crm-status-attribute-type",
      `Attribute "${row.apiSlug ?? row.fieldName}" is a ${row.attributeType} attribute. Only a status attribute has a lifecycle.`,
    );
  }
  if (
    row.storagePolicy !== "mirrored" &&
    row.storagePolicy !== "derived-local" &&
    row.storagePolicy !== "local-authoritative"
  ) {
    throw new CrmLifecycleError(
      "crm-status-attribute-not-writable",
      `Attribute "${row.apiSlug ?? row.fieldName}" has storage policy "${row.storagePolicy}" and holds no local value to transition.`,
    );
  }

  const optionRows = await db
    .select({
      value: schema.crmAttributeOptions.value,
      title: schema.crmAttributeOptions.title,
      position: schema.crmAttributeOptions.position,
      archived: schema.crmAttributeOptions.archived,
      celebrate: schema.crmAttributeOptions.celebrate,
      targetDays: schema.crmAttributeOptions.targetDays,
    })
    .from(schema.crmAttributeOptions)
    .where(
      and(
        eq(schema.crmAttributeOptions.attributeId, row.id),
        accessFilter(
          schema.crmAttributeOptions,
          schema.crmAttributeOptionShares,
        ),
      ),
    );

  const options = optionRows
    .map((option) => ({
      value: option.value,
      title: option.title,
      position: option.position,
      archived: option.archived,
      celebrate: option.celebrate,
      targetDays: option.targetDays,
    }))
    .sort((a, b) => a.position - b.position || a.value.localeCompare(b.value));

  return {
    attribute: {
      id: row.id,
      apiSlug: row.apiSlug ?? row.fieldName,
      attributeType: "status",
      multi: row.multi,
      historyTracked: row.historyTracked,
      valueType: row.valueType,
      storagePolicy: row.storagePolicy,
      fieldPolicyId: row.id,
      label: row.label,
      authority: row.authority,
      archived: row.archived,
    },
    options,
    // ENTERABLE, not "valid": an archived stage keeps every row already parked
    // there (which is why leaving one is always allowed) but accepts nothing new.
    enterableValues: options
      .filter((option) => !option.archived)
      .map((option) => option.value),
    knownValues: options.map((option) => option.value),
  };
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

function quoteList(values: readonly string[]): string {
  return values.length ? values.join(", ") : "(none defined)";
}

/**
 * The reason this transition cannot happen, or `null` when it can.
 *
 * `from === to` is deliberately allowed: a repeat write is idempotent, and the
 * bitemporal writer turns it into no write at all, so a bulk "move these to
 * Won" over a set that already contains Won rows reports them as unchanged
 * rather than blocked. Leaving ANY status — including an unknown or archived
 * one — is allowed for the same reason a retired stage still holds rows: the
 * way out of a bad state must not itself be blocked.
 */
export function crmStatusBlockReason(
  lifecycle: CrmLifecycle,
  input: { from: string | null; to: string; recordTombstoned?: boolean },
): CrmStatusBlock | null {
  const label = lifecycle.attribute.label;

  if (lifecycle.attribute.archived) {
    return {
      code: "attribute-archived",
      message: `Cannot set "${label}" — the attribute is archived. Unarchive it before moving anything through it.`,
    };
  }
  if (lifecycle.attribute.authority === "provider") {
    return {
      code: "provider-authority",
      message: `Cannot set "${label}" locally — the connected provider owns this attribute. Prepare a change and complete it in the provider instead.`,
    };
  }
  if (input.recordTombstoned) {
    return {
      code: "record-tombstoned",
      message: `Cannot move a merged or deleted record through "${label}".`,
    };
  }
  if (!lifecycle.knownValues.includes(input.to)) {
    return {
      code: "unknown-status",
      message: `"${input.to}" is not a value of "${label}". Known values: ${quoteList(lifecycle.knownValues)}. Add the option before moving anything into it.`,
    };
  }
  if (!lifecycle.enterableValues.includes(input.to)) {
    return {
      code: "archived-status",
      message: `Cannot move into "${input.to}" — that value of "${label}" is archived. Pick one of: ${quoteList(lifecycle.enterableValues)}.`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reading current values
// ---------------------------------------------------------------------------

export interface CrmStatusTarget {
  recordId: string;
  /** Set for a LIST-ENTRY status; omitted or null for a record status. */
  entryId?: string | null;
}

interface CurrentStatus {
  fieldId: string;
  value: string | null;
}

function targetKey(target: CrmStatusTarget): string {
  return target.entryId
    ? `entry:${target.entryId}`
    : `record:${target.recordId}`;
}

/**
 * Current status value per target. A target with no row yet maps to `null`,
 * which is a real state (never set) and distinct from a target that is missing
 * from the map entirely (not visible to this caller).
 */
async function readCurrentStatuses(
  db: CrmFieldWriteDb,
  lifecycle: CrmLifecycle,
  targets: CrmStatusTarget[],
  extraWhere?: SQL,
): Promise<Map<string, CurrentStatus>> {
  const entryIds = targets
    .map((target) => target.entryId)
    .filter((entryId): entryId is string => Boolean(entryId));
  const recordIds = targets
    .filter((target) => !target.entryId)
    .map((target) => target.recordId);

  const shapes: SQL[] = [];
  if (entryIds.length) {
    shapes.push(inArray(schema.crmRecordFields.entryId, entryIds) as SQL);
  }
  if (recordIds.length) {
    shapes.push(
      and(
        inArray(schema.crmRecordFields.recordId, recordIds),
        isNull(schema.crmRecordFields.entryId),
      ) as SQL,
    );
  }
  if (!shapes.length) return new Map();

  const rows = await db
    .select({
      id: schema.crmRecordFields.id,
      recordId: schema.crmRecordFields.recordId,
      entryId: schema.crmRecordFields.entryId,
      stringValue: schema.crmRecordFields.stringValue,
    })
    .from(schema.crmRecordFields)
    .where(
      and(
        or(...shapes),
        eq(schema.crmRecordFields.fieldName, lifecycle.attribute.apiSlug),
        isNull(schema.crmRecordFields.activeUntil),
        ...(extraWhere ? [extraWhere] : []),
        accessFilter(schema.crmRecordFields, schema.crmRecordFieldShares),
      ),
    );

  const byTarget = new Map<string, CurrentStatus>();
  for (const row of rows) {
    byTarget.set(targetKey({ recordId: row.recordId, entryId: row.entryId }), {
      fieldId: row.id,
      value: row.stringValue,
    });
  }
  return byTarget;
}

/**
 * Re-read the targets whose status still equals what the partition observed.
 *
 * This is the concurrency guard: the observed `from` values go into the WHERE
 * clause, so a target somebody else moved in between does not come back and is
 * therefore never written with a decision made about its old state.
 *
 * ponytail: inside one transaction this is exact on SQLite/libSQL, which
 * serializes writers. On Postgres read-committed a writer could still commit
 * between this SELECT and the write; move to `SELECT … FOR UPDATE` behind a
 * dialect helper in core if a hosted deployment shows clobbered stage history.
 */
export async function claimCrmStatusTransition(input: {
  db: CrmFieldWriteDb;
  lifecycle: CrmLifecycle;
  /** Targets to claim, each with the status value the decision was based on. */
  expected: Array<{ target: CrmStatusTarget; from: string | null }>;
}): Promise<Set<string>> {
  const withValue = input.expected.filter((entry) => entry.from !== null);
  const withoutValue = input.expected.filter((entry) => entry.from === null);

  const claimed = new Set<string>();

  if (withValue.length) {
    const observed = await readCurrentStatuses(
      input.db,
      input.lifecycle,
      withValue.map((entry) => entry.target),
      inArray(schema.crmRecordFields.stringValue, [
        ...new Set(withValue.map((entry) => entry.from as string)),
      ]) as SQL,
    );
    for (const entry of withValue) {
      const key = targetKey(entry.target);
      if (observed.get(key)?.value === entry.from) claimed.add(key);
    }
  }

  if (withoutValue.length) {
    // "No row" cannot be asserted by matching a value, so it is asserted by its
    // absence: a target that has grown a status row since the partition read is
    // not claimed.
    const observed = await readCurrentStatuses(
      input.db,
      input.lifecycle,
      withoutValue.map((entry) => entry.target),
    );
    for (const entry of withoutValue) {
      const key = targetKey(entry.target);
      if (!observed.has(key)) claimed.add(key);
    }
  }

  return claimed;
}

// ---------------------------------------------------------------------------
// Bulk transition
// ---------------------------------------------------------------------------

export type CrmStatusOutcome = "changed" | "unchanged" | "skipped";

export interface CrmStatusTransitionRow {
  recordId: string;
  entryId: string | null;
  from: string | null;
  to: string;
  outcome: CrmStatusOutcome;
  /** Present on every `skipped` row; absent otherwise. */
  block?: CrmStatusBlock;
  /** Present on every `changed` row: how the bitemporal writer stored it. */
  mode?: "insert" | "close-and-insert" | "update-in-place";
}

export interface CrmStatusTransitionReport {
  attributeId: string;
  apiSlug: string;
  to: string;
  changed: number;
  unchanged: number;
  skipped: number;
  /** Skipped counts keyed by the status they were still in — GTM's shape. */
  skippedByStatus: Record<string, number>;
  skippedByReason: Record<CrmStatusBlockCode, number>;
  rows: CrmStatusTransitionRow[];
}

export interface CrmStatusTransitionInput {
  db: CrmFieldWriteDb;
  lifecycle: CrmLifecycle;
  targets: CrmStatusTarget[];
  to: string;
  actor: { type: CrmActorType; id?: string | null };
  ownership: {
    ownerEmail: string;
    orgId: string | null;
    visibility: "private" | "org" | "public";
  };
  /** Record ids known to be tombstoned; those targets are reported, not written. */
  tombstonedRecordIds?: ReadonlySet<string>;
  now?: string;
}

/**
 * Move a bounded set of records or list entries into one status.
 *
 * Eligible targets are written through `writeCrmRecordField`, so a real move
 * closes the previous value's row and opens a new one — that pair IS the
 * time-in-stage history. Ineligible targets come back in `rows` with the
 * sentence explaining why; nothing is written for them and nothing is dropped.
 */
export async function applyCrmStatusTransitions(
  input: CrmStatusTransitionInput,
): Promise<CrmStatusTransitionReport> {
  if (input.targets.length > MAX_STATUS_TRANSITION_TARGETS) {
    throw new CrmLifecycleError(
      "crm-status-transition-too-many",
      `A status transition may cover at most ${MAX_STATUS_TRANSITION_TARGETS} targets; received ${input.targets.length}.`,
    );
  }

  const now = input.now ?? new Date().toISOString();
  const tombstoned = input.tombstonedRecordIds ?? new Set<string>();
  const current = await readCurrentStatuses(
    input.db,
    input.lifecycle,
    input.targets,
  );

  const rows: CrmStatusTransitionRow[] = [];
  const eligible: Array<{ target: CrmStatusTarget; from: string | null }> = [];

  for (const target of input.targets) {
    const from = current.get(targetKey(target))?.value ?? null;
    const block = crmStatusBlockReason(input.lifecycle, {
      from,
      to: input.to,
      recordTombstoned: tombstoned.has(target.recordId),
    });
    if (block) {
      rows.push({
        recordId: target.recordId,
        entryId: target.entryId ?? null,
        from,
        to: input.to,
        outcome: "skipped",
        block,
      });
      continue;
    }
    eligible.push({ target, from });
  }

  const claimed = eligible.length
    ? await claimCrmStatusTransition({
        db: input.db,
        lifecycle: input.lifecycle,
        expected: eligible,
      })
    : new Set<string>();

  for (const entry of eligible) {
    const key = targetKey(entry.target);
    if (!claimed.has(key)) {
      rows.push({
        recordId: entry.target.recordId,
        entryId: entry.target.entryId ?? null,
        from: entry.from,
        to: input.to,
        outcome: "skipped",
        block: {
          code: "concurrent-transition",
          message: `"${input.lifecycle.attribute.label}" changed from "${entry.from ?? "(not set)"}" while this move was being prepared, so it was left alone. Re-read it and decide again.`,
        },
      });
      continue;
    }

    const result = await writeCrmRecordField({
      db: input.db,
      target: {
        recordId: entry.target.recordId,
        entryId: entry.target.entryId ?? null,
      },
      attribute: input.lifecycle.attribute,
      value: input.to,
      actor: input.actor,
      ownership: input.ownership,
      now,
    });
    rows.push({
      recordId: entry.target.recordId,
      entryId: entry.target.entryId ?? null,
      from: entry.from,
      to: input.to,
      outcome: result.changed ? "changed" : "unchanged",
      ...(result.changed ? { mode: result.mode } : {}),
    });
  }

  const skippedByStatus: Record<string, number> = {};
  const skippedByReason = {} as Record<CrmStatusBlockCode, number>;
  for (const row of rows) {
    if (row.outcome !== "skipped" || !row.block) continue;
    const status = row.from ?? "(not set)";
    skippedByStatus[status] = (skippedByStatus[status] ?? 0) + 1;
    skippedByReason[row.block.code] =
      (skippedByReason[row.block.code] ?? 0) + 1;
  }

  return {
    attributeId: input.lifecycle.attribute.id,
    apiSlug: input.lifecycle.attribute.apiSlug,
    to: input.to,
    changed: rows.filter((row) => row.outcome === "changed").length,
    unchanged: rows.filter((row) => row.outcome === "unchanged").length,
    skipped: rows.filter((row) => row.outcome === "skipped").length,
    skippedByStatus,
    skippedByReason,
    rows,
  };
}

// ---------------------------------------------------------------------------
// Single-target entry points
// ---------------------------------------------------------------------------

/**
 * Move one record or list entry into a status.
 *
 * A single-target caller has nowhere to put a partition report, so a blocked
 * target is raised as the sentence it must act on rather than returned as a row
 * nobody reads — including the concurrency block, whose whole point is that the
 * caller re-reads and decides again.
 */
export async function applyOneCrmStatusTransition(
  input: Omit<CrmStatusTransitionInput, "targets"> & {
    target: CrmStatusTarget;
  },
): Promise<{
  changed: boolean;
  mode?: "insert" | "close-and-insert" | "update-in-place";
}> {
  const { target, ...rest } = input;
  const report = await applyCrmStatusTransitions({
    ...rest,
    targets: [target],
  });
  const [row] = report.rows;
  if (!row) {
    throw new CrmLifecycleError(
      "crm-status-transition-unreported",
      `"${input.lifecycle.attribute.label}" was neither transitioned nor blocked for ${
        target.entryId ? `entry ${target.entryId}` : `record ${target.recordId}`
      }. Nothing was written; report this rather than retrying.`,
    );
  }
  if (row.block) throw new CrmLifecycleError(row.block.code, row.block.message);
  return {
    changed: row.outcome === "changed",
    ...(row.mode ? { mode: row.mode } : {}),
  };
}

/**
 * Throw the reason this target cannot enter `to`, or return the value it would
 * move from.
 *
 * The gate half, for a caller that owns its own atomic write and its own
 * concurrency check: `update-crm-record` is one revision-checked mutation with
 * an audit row covering the whole patch, so routing its status fields into a
 * second writer would leave that row claiming fields it did not write.
 */
export async function assertCrmStatusTransitionAllowed(input: {
  db: CrmFieldWriteDb;
  lifecycle: CrmLifecycle;
  target: CrmStatusTarget;
  to: string;
  recordTombstoned?: boolean;
}): Promise<{ from: string | null }> {
  const current = await readCurrentStatuses(input.db, input.lifecycle, [
    input.target,
  ]);
  const from = current.get(targetKey(input.target))?.value ?? null;
  const block = crmStatusBlockReason(input.lifecycle, {
    from,
    to: input.to,
    recordTombstoned: input.recordTombstoned,
  });
  if (block) throw new CrmLifecycleError(block.code, block.message);
  return { from };
}
