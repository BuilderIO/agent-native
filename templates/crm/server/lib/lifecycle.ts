
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

export const MAX_STATUS_TRANSITION_TARGETS = 200;

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
  options: CrmStatusOption[];
  enterableValues: string[];
  knownValues: string[];
}

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
    enterableValues: options
      .filter((option) => !option.archived)
      .map((option) => option.value),
    knownValues: options.map((option) => option.value),
  };
}


function quoteList(values: readonly string[]): string {
  return values.length ? values.join(", ") : "(none defined)";
}

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


export interface CrmStatusTarget {
  recordId: string;
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
 * ponytail: on Postgres read-committed a writer could still commit between
 * this SELECT and the write; move to `SELECT … FOR UPDATE` if a hosted
 * deployment shows clobbered stage history.
 */
export async function claimCrmStatusTransition(input: {
  db: CrmFieldWriteDb;
  lifecycle: CrmLifecycle;
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


export type CrmStatusOutcome = "changed" | "unchanged" | "skipped";

export interface CrmStatusTransitionRow {
  recordId: string;
  entryId: string | null;
  from: string | null;
  to: string;
  outcome: CrmStatusOutcome;
  block?: CrmStatusBlock;
  mode?: "insert" | "close-and-insert" | "update-in-place";
}

export interface CrmStatusTransitionReport {
  attributeId: string;
  apiSlug: string;
  to: string;
  changed: number;
  unchanged: number;
  skipped: number;
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
  tombstonedRecordIds?: ReadonlySet<string>;
  now?: string;
}

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
