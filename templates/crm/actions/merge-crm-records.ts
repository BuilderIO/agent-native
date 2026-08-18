import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  writeCrmRecordField,
  CrmAttributeValueError,
  type CrmFieldWriteDb,
  type CrmWritableAttribute,
} from "../server/lib/record-fields.js";
import { storageColumnFor } from "../shared/crm-attributes.js";
import { decideCrmWritePolicy, type CrmValue } from "../shared/crm-contract.js";
import {
  crmInitiatedBy,
  scopedCrmIdempotencyKey,
  toJson,
} from "./_crm-action-utils.js";

/**
 * Merging is destructive-shaped and touches identity, so it is approval-gated
 * for every non-human caller by `decideCrmWritePolicy`. The same input feeds the
 * `needsApproval` gate and the ledger row, so what the agent was gated on and
 * what the audit trail records cannot drift apart.
 */
const MERGE_WRITE_POLICY = {
  target: "local",
  reversibility: "destructive",
  scope: "single-record",
  risk: "ownership",
  delegatedAuthority: false,
  storedAutomationPolicy: false,
} as const;

/** Most rows of one kind a single merge will move. Beyond this, fail loud. */
const MAX_MERGE_ROWS = 500;

/** Relationship type that points a merged-away record at the record that won. */
export const CRM_MERGED_INTO_RELATIONSHIP = "merged-into";

class CrmMergeError extends CrmAttributeValueError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "CrmMergeError";
  }
}

type CrmTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

interface StoredValue {
  stringValue: string | null;
  numberValue: number | null;
  booleanValue: boolean | null;
  jsonValue: string | null;
}

/**
 * Decode a stored value using the attribute's declared storage column rather
 * than guessing from which column is non-null — a `false` checkbox and an empty
 * text field are otherwise indistinguishable, and a merge that guessed would
 * promote the wrong one.
 */
function decodeStoredValue(
  attribute: CrmWritableAttribute,
  row: StoredValue,
): CrmValue {
  const column = storageColumnFor(attribute.attributeType, attribute.multi);
  if (column === "numberValue") return row.numberValue;
  if (column === "booleanValue") return row.booleanValue;
  if (column === "jsonValue") {
    if (row.jsonValue === null) return null;
    try {
      return JSON.parse(row.jsonValue) as CrmValue;
    } catch {
      throw new CrmMergeError(
        "crm-merge-value-unreadable",
        `A stored value for "${attribute.apiSlug}" on the duplicate is not readable JSON, so this merge cannot promote it. Repair the record before merging.`,
      );
    }
  }
  return row.stringValue;
}

async function idsToMove(
  label: string,
  rows: Promise<Array<{ id: string }>>,
): Promise<string[]> {
  const found = await rows;
  if (found.length > MAX_MERGE_ROWS) {
    throw new CrmMergeError(
      "crm-merge-too-large",
      `The duplicate has more than ${MAX_MERGE_ROWS} ${label} rows. Split the merge or archive some of them first — a partial merge is worse than none.`,
    );
  }
  return found.map((row) => row.id);
}

export default defineAction({
  description:
    "Merge a duplicate CRM record into a survivor. Field values the survivor is missing are promoted through the bitemporal writer, and list entries, tasks, notes, interactions, signals, call evidence, and relationships from BOTH records end up on the survivor. The duplicate is never deleted: it is tombstoned and linked to the survivor, so the merge is reversible by history and safe to re-run. Find candidates with find-crm-duplicates first; this action never picks the survivor for you.",
  schema: z.object({
    survivorRecordId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .describe("The record that keeps its identity."),
    duplicateRecordId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .describe("The record that is merged away and tombstoned."),
    idempotencyKey: z.string().trim().min(1).max(256).optional(),
  }),
  needsApproval: (_args, ctx?: ActionRunContext) =>
    decideCrmWritePolicy({
      ...MERGE_WRITE_POLICY,
      initiatedBy: crmInitiatedBy(ctx),
    }) !== "execute",
  audit: {
    target: (_args, result) => {
      const merge = result as {
        survivorRecordId: string;
        ownerEmail: string;
        orgId: string | null;
        visibility: "private" | "org" | "public";
      };
      return {
        type: "crm-record",
        id: merge.survivorRecordId,
        ownerEmail: merge.ownerEmail,
        orgId: merge.orgId,
        visibility: merge.visibility,
      };
    },
    summary: (args) =>
      `Merged CRM record ${args.duplicateRecordId} into ${args.survivorRecordId}`,
    recordInputs: false,
  },
  run: async (args, ctx?: ActionRunContext) => {
    if (args.survivorRecordId === args.duplicateRecordId) {
      throw new CrmMergeError(
        "crm-merge-same-record",
        "A record cannot be merged into itself.",
      );
    }
    await assertAccess("crm-record", args.survivorRecordId, "editor");
    await assertAccess("crm-record", args.duplicateRecordId, "editor");

    const db = getDb();
    const rows = await db
      .select()
      .from(schema.crmRecords)
      .where(
        and(
          inArray(schema.crmRecords.id, [
            args.survivorRecordId,
            args.duplicateRecordId,
          ]),
          accessFilter(
            schema.crmRecords,
            schema.crmRecordShares,
            undefined,
            "editor",
          ),
        ),
      );
    const survivor = rows.find((row) => row.id === args.survivorRecordId);
    const duplicate = rows.find((row) => row.id === args.duplicateRecordId);
    if (!survivor || !duplicate) {
      throw new CrmMergeError(
        "crm-merge-record-not-found",
        `Both records must exist and be editable by you. Missing: ${[
          !survivor ? args.survivorRecordId : null,
          !duplicate ? args.duplicateRecordId : null,
        ]
          .filter(Boolean)
          .join(", ")}.`,
      );
    }
    if (survivor.objectType !== duplicate.objectType) {
      throw new CrmMergeError(
        "crm-merge-object-type-mismatch",
        `Cannot merge a "${duplicate.objectType}" record into a "${survivor.objectType}" record. Merge only applies within one object type.`,
      );
    }
    if (survivor.tombstone) {
      throw new CrmMergeError(
        "crm-merge-survivor-tombstoned",
        "The survivor is tombstoned. Pick a live record to merge into.",
      );
    }

    const initiatedBy = crmInitiatedBy(ctx);
    const decision = decideCrmWritePolicy({
      ...MERGE_WRITE_POLICY,
      initiatedBy,
    });
    if (decision === "deny") {
      throw new CrmMergeError(
        "crm-merge-denied",
        "This CRM merge is not authorized by the current write policy.",
      );
    }

    const ownership = {
      ownerEmail: survivor.ownerEmail,
      orgId: survivor.orgId,
      visibility: survivor.visibility,
    };
    const idempotencyKey = await scopedCrmIdempotencyKey({
      ownerEmail: ownership.ownerEmail,
      orgId: ownership.orgId,
      recordId: survivor.id,
      key: args.idempotencyKey ?? `merge:${duplicate.id}`,
    });

    // Re-running a merge must be a no-op, not a second one. The prior ledger row
    // is the authority; a duplicate already merged somewhere ELSE is an error,
    // because silently re-parenting it would rewrite a decision a human made.
    const [priorMutation] = await db
      .select()
      .from(schema.crmMutations)
      .where(
        and(
          eq(schema.crmMutations.idempotencyKey, idempotencyKey),
          accessFilter(schema.crmMutations, schema.crmMutationShares),
        ),
      )
      .limit(1);
    if (priorMutation) {
      return {
        mutationId: priorMutation.id,
        survivorRecordId: survivor.id,
        duplicateRecordId: duplicate.id,
        status: "applied" as const,
        replayed: true as const,
        decision: priorMutation.policyDecision,
        ...ownership,
      };
    }
    if (duplicate.tombstone) {
      const [existingLink] = await db
        .select({ toRecordId: schema.crmRelationships.toRecordId })
        .from(schema.crmRelationships)
        .where(
          and(
            eq(schema.crmRelationships.fromRecordId, duplicate.id),
            eq(
              schema.crmRelationships.relationshipType,
              CRM_MERGED_INTO_RELATIONSHIP,
            ),
            accessFilter(schema.crmRelationships, schema.crmRelationshipShares),
          ),
        )
        .limit(1);
      throw new CrmMergeError(
        "crm-merge-duplicate-tombstoned",
        existingLink
          ? `"${duplicate.displayName}" was already merged into record ${existingLink.toRecordId}. Merge that record instead.`
          : `"${duplicate.displayName}" is tombstoned and cannot be merged.`,
      );
    }

    const now = new Date().toISOString();
    const mutationId = crypto.randomUUID();

    const outcome = await db.transaction(async (tx) => {
      // --- field values ------------------------------------------------------
      const attributeRows = await tx
        .select({
          id: schema.crmFieldPolicies.id,
          apiSlug: schema.crmFieldPolicies.apiSlug,
          fieldName: schema.crmFieldPolicies.fieldName,
          attributeType: schema.crmFieldPolicies.attributeType,
          multi: schema.crmFieldPolicies.multi,
          historyTracked: schema.crmFieldPolicies.historyTracked,
          valueType: schema.crmFieldPolicies.valueType,
          storagePolicy: schema.crmFieldPolicies.storagePolicy,
        })
        .from(schema.crmFieldPolicies)
        .where(
          and(
            eq(schema.crmFieldPolicies.connectionId, survivor.connectionId),
            eq(schema.crmFieldPolicies.objectType, survivor.objectType),
            eq(schema.crmFieldPolicies.archived, false),
            accessFilter(schema.crmFieldPolicies, schema.crmFieldPolicyShares),
          ),
        );
      const attributeBySlug = new Map<string, CrmWritableAttribute>();
      for (const row of attributeRows) {
        if (
          row.storagePolicy !== "mirrored" &&
          row.storagePolicy !== "derived-local" &&
          row.storagePolicy !== "local-authoritative"
        ) {
          continue;
        }
        attributeBySlug.set(row.apiSlug ?? row.fieldName, {
          id: row.id,
          apiSlug: row.apiSlug ?? row.fieldName,
          attributeType: row.attributeType,
          multi: row.multi,
          historyTracked: row.historyTracked,
          valueType: row.valueType,
          storagePolicy: row.storagePolicy,
          fieldPolicyId: row.id,
        });
      }

      const currentValues = await tx
        .select({
          recordId: schema.crmRecordFields.recordId,
          fieldName: schema.crmRecordFields.fieldName,
          stringValue: schema.crmRecordFields.stringValue,
          numberValue: schema.crmRecordFields.numberValue,
          booleanValue: schema.crmRecordFields.booleanValue,
          jsonValue: schema.crmRecordFields.jsonValue,
        })
        .from(schema.crmRecordFields)
        .where(
          and(
            inArray(schema.crmRecordFields.recordId, [
              survivor.id,
              duplicate.id,
            ]),
            isNull(schema.crmRecordFields.entryId),
            isNull(schema.crmRecordFields.activeUntil),
            accessFilter(schema.crmRecordFields, schema.crmRecordFieldShares),
          ),
        );
      const survivorSlugs = new Set(
        currentValues
          .filter((row) => row.recordId === survivor.id)
          .map((row) => row.fieldName),
      );

      const promotedFields: string[] = [];
      // Slugs that exist on the duplicate but not as an attribute of the
      // survivor's object. Reported, never dropped in silence — the value is
      // still readable on the tombstoned record's history.
      const unmappedFields: string[] = [];
      for (const row of currentValues) {
        if (row.recordId !== duplicate.id) continue;
        if (survivorSlugs.has(row.fieldName)) continue;
        const attribute = attributeBySlug.get(row.fieldName);
        if (!attribute) {
          unmappedFields.push(row.fieldName);
          continue;
        }
        const value = decodeStoredValue(attribute, row);
        if (value === null) continue;
        const result = await writeCrmRecordField({
          db: tx as CrmFieldWriteDb,
          target: { recordId: survivor.id, entryId: null },
          attribute,
          value,
          actor: { type: "user", id: ctx?.userEmail ?? null },
          ownership,
          provenanceJson: toJson(
            [
              {
                provider: duplicate.provider,
                connectionId: duplicate.connectionId,
                objectType: duplicate.objectType,
                remoteId: duplicate.remoteId,
                fieldName: row.fieldName,
                observedAt: now,
                evidenceRef: `crm-merge:${duplicate.id}`,
              },
            ],
            2_000,
          ),
          now,
        });
        if (result.changed) promotedFields.push(row.fieldName);
      }

      // --- everything that hangs off the duplicate ---------------------------
      const entryIds = await idsToMove(
        "list entry",
        tx
          .select({ id: schema.crmListEntries.id })
          .from(schema.crmListEntries)
          .where(
            and(
              eq(schema.crmListEntries.recordId, duplicate.id),
              accessFilter(
                schema.crmListEntries,
                schema.crmListEntryShares,
                undefined,
                "editor",
              ),
            ),
          )
          .limit(MAX_MERGE_ROWS + 1),
      );
      if (entryIds.length) {
        await tx
          .update(schema.crmListEntries)
          .set({ recordId: survivor.id, updatedAt: now })
          .where(inArray(schema.crmListEntries.id, entryIds));
        // Entry attribute values carry `record_id` alongside `entry_id`. This is
        // a RE-PARENT, not a value change: the value is unchanged, so it must
        // not open a history row the way the attribute writer would.
        await tx
          .update(schema.crmRecordFields)
          .set({ recordId: survivor.id, updatedAt: now })
          .where(
            and(
              inArray(schema.crmRecordFields.entryId, entryIds),
              accessFilter(
                schema.crmRecordFields,
                schema.crmRecordFieldShares,
                undefined,
                "editor",
              ),
            ),
          );
      }

      const taskIds = await idsToMove(
        "task",
        tx
          .select({ id: schema.crmTasks.id })
          .from(schema.crmTasks)
          .where(
            and(
              eq(schema.crmTasks.recordId, duplicate.id),
              accessFilter(
                schema.crmTasks,
                schema.crmTaskShares,
                undefined,
                "editor",
              ),
            ),
          )
          .limit(MAX_MERGE_ROWS + 1),
      );
      if (taskIds.length) {
        await tx
          .update(schema.crmTasks)
          .set({ recordId: survivor.id, updatedAt: now })
          .where(inArray(schema.crmTasks.id, taskIds));
      }

      // Notes are interactions with `kind: "note"`; they move with every other
      // interaction so the survivor keeps the whole conversation.
      const interactionIds = await idsToMove(
        "interaction",
        tx
          .select({ id: schema.crmInteractions.id })
          .from(schema.crmInteractions)
          .where(
            and(
              eq(schema.crmInteractions.recordId, duplicate.id),
              accessFilter(
                schema.crmInteractions,
                schema.crmInteractionShares,
                undefined,
                "editor",
              ),
            ),
          )
          .limit(MAX_MERGE_ROWS + 1),
      );
      if (interactionIds.length) {
        await tx
          .update(schema.crmInteractions)
          .set({ recordId: survivor.id, updatedAt: now })
          .where(inArray(schema.crmInteractions.id, interactionIds));
      }

      const evidenceIds = await idsToMove(
        "call evidence",
        tx
          .select({ id: schema.crmCallEvidence.id })
          .from(schema.crmCallEvidence)
          .where(
            and(
              eq(schema.crmCallEvidence.recordId, duplicate.id),
              accessFilter(
                schema.crmCallEvidence,
                schema.crmCallEvidenceShares,
                undefined,
                "editor",
              ),
            ),
          )
          .limit(MAX_MERGE_ROWS + 1),
      );
      if (evidenceIds.length) {
        await tx
          .update(schema.crmCallEvidence)
          .set({ recordId: survivor.id, updatedAt: now })
          .where(inArray(schema.crmCallEvidence.id, evidenceIds));
      }

      const signalIds = await idsToMove(
        "signal",
        tx
          .select({ id: schema.crmSignals.id })
          .from(schema.crmSignals)
          .where(
            and(
              eq(schema.crmSignals.recordId, duplicate.id),
              accessFilter(
                schema.crmSignals,
                schema.crmSignalShares,
                undefined,
                "editor",
              ),
            ),
          )
          .limit(MAX_MERGE_ROWS + 1),
      );
      if (signalIds.length) {
        await tx
          .update(schema.crmSignals)
          .set({ recordId: survivor.id, updatedAt: now })
          .where(inArray(schema.crmSignals.id, signalIds));
      }

      const signalRunIds = await idsToMove(
        "signal run",
        tx
          .select({ id: schema.crmSignalRuns.id })
          .from(schema.crmSignalRuns)
          .where(
            and(
              eq(schema.crmSignalRuns.recordId, duplicate.id),
              accessFilter(
                schema.crmSignalRuns,
                schema.crmSignalRunShares,
                undefined,
                "editor",
              ),
            ),
          )
          .limit(MAX_MERGE_ROWS + 1),
      );
      if (signalRunIds.length) {
        await tx
          .update(schema.crmSignalRuns)
          .set({ recordId: survivor.id, updatedAt: now })
          .where(inArray(schema.crmSignalRuns.id, signalRunIds));
      }

      const relationshipIds = await idsToMove(
        "relationship",
        tx
          .select({ id: schema.crmRelationships.id })
          .from(schema.crmRelationships)
          .where(
            and(
              or(
                eq(schema.crmRelationships.fromRecordId, duplicate.id),
                eq(schema.crmRelationships.toRecordId, duplicate.id),
              ),
              accessFilter(
                schema.crmRelationships,
                schema.crmRelationshipShares,
                undefined,
                "editor",
              ),
            ),
          )
          .limit(MAX_MERGE_ROWS + 1),
      );
      if (relationshipIds.length) {
        await tx
          .update(schema.crmRelationships)
          .set({ fromRecordId: survivor.id, updatedAt: now })
          .where(
            and(
              inArray(schema.crmRelationships.id, relationshipIds),
              eq(schema.crmRelationships.fromRecordId, duplicate.id),
            ),
          );
        await tx
          .update(schema.crmRelationships)
          .set({ toRecordId: survivor.id, updatedAt: now })
          .where(
            and(
              inArray(schema.crmRelationships.id, relationshipIds),
              eq(schema.crmRelationships.toRecordId, duplicate.id),
            ),
          );
      }

      // --- tombstone and link ------------------------------------------------
      // The loser is never hard-deleted: its history, provenance, and provider
      // identity tuple stay readable, and this edge is what makes the merge
      // traceable in both directions.
      await tx.insert(schema.crmRelationships).values({
        id: crypto.randomUUID(),
        connectionId: duplicate.connectionId,
        fromRecordId: duplicate.id,
        toRecordId: survivor.id,
        relationshipType: CRM_MERGED_INTO_RELATIONSHIP,
        label: "Merged into",
        inverseLabel: "Merged from",
        ...ownership,
        createdAt: now,
        updatedAt: now,
      });
      await tx
        .update(schema.crmRecords)
        .set({ tombstone: true, updatedAt: now })
        .where(
          and(
            eq(schema.crmRecords.id, duplicate.id),
            accessFilter(
              schema.crmRecords,
              schema.crmRecordShares,
              undefined,
              "editor",
            ),
          ),
        );

      const moved = {
        listEntries: entryIds.length,
        tasks: taskIds.length,
        interactions: interactionIds.length,
        callEvidence: evidenceIds.length,
        signals: signalIds.length,
        signalRuns: signalRunIds.length,
        relationships: relationshipIds.length,
      };
      await tx.insert(schema.crmMutations).values({
        id: mutationId,
        recordId: survivor.id,
        connectionId: survivor.connectionId,
        operation: "update",
        initiatedBy,
        target: "local",
        policyDecision: decision,
        risk: MERGE_WRITE_POLICY.risk,
        status: "applied",
        patchJson: toJson(
          {
            merge: {
              survivorRecordId: survivor.id,
              duplicateRecordId: duplicate.id,
            },
            promotedFields,
            unmappedFields,
            moved,
          },
          12_000,
        ),
        beforeJson: toJson(
          {
            duplicate: {
              id: duplicate.id,
              displayName: duplicate.displayName,
              remoteId: duplicate.remoteId,
              provider: duplicate.provider,
            },
          },
          2_000,
        ),
        afterJson: toJson({ survivorRecordId: survivor.id, moved }, 2_000),
        idempotencyKey,
        appliedAt: now,
        ...ownership,
        createdAt: now,
        updatedAt: now,
      });

      return { promotedFields, unmappedFields, moved };
    });

    return {
      mutationId,
      survivorRecordId: survivor.id,
      duplicateRecordId: duplicate.id,
      status: "applied" as const,
      replayed: false as const,
      decision,
      duplicateTombstoned: true,
      ...outcome,
      ...ownership,
    };
  },
});
