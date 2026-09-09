import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { and, eq, inArray, sql } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import {
  removeContentRelationPropertyInputSchema,
  type RelationshipInvalidation,
  type RemoveContentRelationPropertyInput,
  type RemoveContentRelationPropertyResult,
} from "../shared/relationships.js";
import { lockContentDatabaseMutation } from "./_content-database-mutation-lock.js";
import { nanoid } from "./_property-utils.js";
import { authorizeRelationshipRoute } from "./_relationship-authority.js";
import {
  activeActivationIdsForLineages,
  appendRelationshipEvent,
  createRelationshipRevision,
  insertRelationshipReceipt,
  loadRelationshipDatabase,
  loadRelationshipTypeBundle,
  lockRelationshipLineages,
  lockRelationshipOperation,
  lockRelationshipTypes,
  relationshipActorContext,
  relationshipError,
  relationshipProjectionDto,
  relationshipRequestHash,
  requireRelationshipDocumentAccess,
  replayRelationshipReceipt,
  retireRelationshipActivations,
  type RelationshipDb,
} from "./_relationship-core.js";
import {
  relationshipRemovalSelectionEntrySchema,
  type RelationshipRemovalSelectionEntry,
} from "./prepare-content-relationship-removal.js";

function parseRemovalSelection(
  value: string,
): RelationshipRemovalSelectionEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    relationshipError(
      "UNAVAILABLE",
      "The relationship removal selection is unreadable.",
      { statusCode: 503 },
    );
  }
  const result = relationshipRemovalSelectionEntrySchema
    .array()
    .safeParse(parsed);
  if (!result.success) {
    relationshipError(
      "UNAVAILABLE",
      "The relationship removal selection is invalid.",
      { statusCode: 503 },
    );
  }
  return result.data;
}

function selectRemovalEntries(
  entries: RelationshipRemovalSelectionEntry[],
  edgeIds: string[] | undefined,
): RelationshipRemovalSelectionEntry[] {
  if (!edgeIds) return entries;
  const requestedIds = new Set(edgeIds);
  const entriesById = new Map(entries.map((entry) => [entry.edgeId, entry]));
  if (
    requestedIds.size !== edgeIds.length ||
    edgeIds.some((edgeId) => !entriesById.has(edgeId))
  ) {
    relationshipError(
      "STALE_SELECTION",
      "The relationship removal selection is stale.",
      { statusCode: 409 },
    );
  }
  return entries.filter((entry) => requestedIds.has(entry.edgeId));
}

async function loadProjectionAndDefinition(
  db: RelationshipDb,
  propertyId: string,
) {
  const [projection] = await db
    .select()
    .from(schema.contentRelationshipProjections)
    .where(eq(schema.contentRelationshipProjections.propertyId, propertyId));
  if (!projection) {
    relationshipError(
      "NOT_ACCESSIBLE",
      "The requested relation Property is not accessible.",
      { statusCode: 404 },
    );
  }
  const [definition] = await db
    .select()
    .from(schema.documentPropertyDefinitions)
    .where(eq(schema.documentPropertyDefinitions.id, propertyId));
  return { projection, definition: definition ?? null };
}

async function preflightSelection(
  db: RelationshipDb,
  entries: RelationshipRemovalSelectionEntry[],
  context?: ActionRunContext,
) {
  for (const entry of entries) {
    const bundle = await loadRelationshipTypeBundle(entry.typeId, {
      allowArchived: true,
      db,
    });
    if (bundle.version.id !== entry.typeVersionId) {
      relationshipError(
        "STALE_SELECTION",
        "The selected relationship definition changed.",
        { statusCode: 409 },
      );
    }
    await authorizeRelationshipRoute({
      db,
      bundle,
      sourcePageId: entry.sourcePageId,
      targetPageId: entry.targetPageId,
      route: entry.route,
      operation: "remove",
      context,
    });
  }
}

async function assertRemovalReceiptAccessible(
  db: RelationshipDb,
  entries: RelationshipRemovalSelectionEntry[],
  context?: ActionRunContext,
): Promise<void> {
  const bundles = new Map<
    string,
    Awaited<ReturnType<typeof loadRelationshipTypeBundle>>
  >();
  for (const entry of entries) {
    let bundle = bundles.get(entry.typeId);
    if (!bundle) {
      bundle = await loadRelationshipTypeBundle(entry.typeId, {
        allowArchived: true,
        db,
      });
      await Promise.all([
        loadRelationshipDatabase(
          bundle.version.sourceDatabaseId,
          "viewer",
          db,
          context,
          { allowDeleted: true },
        ),
        loadRelationshipDatabase(
          bundle.version.targetDatabaseId,
          "viewer",
          db,
          context,
          { allowDeleted: true },
        ),
      ]);
      bundles.set(entry.typeId, bundle);
    }
    await Promise.all([
      requireRelationshipDocumentAccess(entry.sourcePageId, "viewer", {
        db,
        context,
      }),
      requireRelationshipDocumentAccess(entry.targetPageId, "viewer", {
        db,
        context,
      }),
    ]);
  }
}

async function removeContentRelationProperty(
  input: RemoveContentRelationPropertyInput,
  context?: ActionRunContext,
): Promise<RemoveContentRelationPropertyResult> {
  const db = getDb();
  const initial = await loadProjectionAndDefinition(db, input.propertyId);
  const database = await loadRelationshipDatabase(
    initial.projection.databaseId,
    "admin",
    db,
    context,
  );
  const actor = relationshipActorContext(context);
  let initialSelection:
    | typeof schema.contentRelationshipRemovalSelections.$inferSelect
    | null = null;
  let entries: RelationshipRemovalSelectionEntry[] = [];
  if (input.relationshipMode.kind === "remove-selected") {
    [initialSelection] = await db
      .select()
      .from(schema.contentRelationshipRemovalSelections)
      .where(
        eq(
          schema.contentRelationshipRemovalSelections.token,
          input.relationshipMode.selectionReceipt,
        ),
      );
    if (
      !initialSelection ||
      initialSelection.callerScope !== actor.callerScope ||
      initialSelection.propertyId !== input.propertyId
    ) {
      relationshipError(
        "STALE_SELECTION",
        "The relationship removal selection does not match this Property.",
        { statusCode: 409 },
      );
    }
    entries = selectRemovalEntries(
      parseRemovalSelection(initialSelection.selectionJson),
      input.relationshipMode.edgeIds,
    );
  }
  const requestHash = relationshipRequestHash(input);
  const tenant = {
    ownerEmail: initial.projection.ownerEmail,
    orgId: initial.projection.orgId,
    spaceId: initial.projection.spaceId,
  };

  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as RelationshipDb;
    await lockRelationshipOperation(tx, {
      tenant,
      operationId: input.operationId,
      context,
    });
    await lockContentDatabaseMutation(tx, database.database.id);
    const lockedDatabase = await loadRelationshipDatabase(
      database.database.id,
      "admin",
      tx,
      context,
    );
    const replayed =
      await replayRelationshipReceipt<RemoveContentRelationPropertyResult>(tx, {
        spaceId: tenant.spaceId,
        operationId: input.operationId,
        requestHash,
        context,
      });
    if (replayed) {
      await assertRemovalReceiptAccessible(tx, entries, context);
      return replayed;
    }

    const current = await loadProjectionAndDefinition(tx, input.propertyId);
    if (current.projection.archivedAt || !current.definition) {
      relationshipError(
        "STALE_RECOVERY",
        "The relation Property has already been removed.",
        { statusCode: 409 },
      );
    }
    await lockRelationshipTypes(tx, [current.projection.relationshipTypeId]);
    await lockRelationshipLineages(
      tx,
      entries.map((entry) => entry.edgeId),
    );
    let selection:
      | typeof schema.contentRelationshipRemovalSelections.$inferSelect
      | null = null;
    if (input.relationshipMode.kind === "remove-selected") {
      await tx
        .update(schema.contentRelationshipRemovalSelections)
        .set({
          usedAt: sql`${schema.contentRelationshipRemovalSelections.usedAt}`,
        })
        .where(
          eq(
            schema.contentRelationshipRemovalSelections.token,
            input.relationshipMode.selectionReceipt,
          ),
        )
        .returning({
          token: schema.contentRelationshipRemovalSelections.token,
        });
      [selection] = await tx
        .select()
        .from(schema.contentRelationshipRemovalSelections)
        .where(
          eq(
            schema.contentRelationshipRemovalSelections.token,
            input.relationshipMode.selectionReceipt,
          ),
        );
      if (
        !selection ||
        selection.callerScope !== actor.callerScope ||
        selection.propertyId !== input.propertyId ||
        selection.usedAt ||
        selection.expiresAt <= new Date().toISOString()
      ) {
        relationshipError(
          "STALE_SELECTION",
          "The relationship removal selection is stale.",
          { statusCode: 409 },
        );
      }
      entries = selectRemovalEntries(
        parseRemovalSelection(selection.selectionJson),
        input.relationshipMode.edgeIds,
      );
      await preflightSelection(tx, entries, context);
      const activeByLineage = await activeActivationIdsForLineages(
        tx,
        entries.map((entry) => entry.edgeId),
      );
      for (const entry of entries) {
        const active = new Set(activeByLineage.get(entry.edgeId) ?? []);
        if (
          entry.observedActivationIds.some(
            (activationId) => !active.has(activationId),
          )
        ) {
          relationshipError(
            "STALE_SELECTION",
            "A selected relationship changed before removal.",
            { statusCode: 409 },
          );
        }
      }
    }

    const lockedBundle = await loadRelationshipTypeBundle(
      current.projection.relationshipTypeId,
      { allowArchived: true, db: tx },
    );
    const [mappedField] = await tx
      .select({ id: schema.contentDatabaseSourceFields.id })
      .from(schema.contentDatabaseSourceFields)
      .where(
        eq(schema.contentDatabaseSourceFields.propertyId, input.propertyId),
      );
    if (mappedField) {
      relationshipError(
        "SOURCE_AUTHORITY_UNSUPPORTED",
        "Source-mapped relation Property removal is not supported.",
        { statusCode: 409 },
      );
    }
    if (lockedDatabase.database.naturalKeyPropertyId === input.propertyId) {
      relationshipError(
        "UNSUPPORTED_CONFIGURATION",
        "A relation Property used as the Database natural key cannot be removed.",
        { statusCode: 409 },
      );
    }
    const oldDefinition = current.definition;
    const oldProjection = current.projection;
    const revision = await createRelationshipRevision(tx, {
      tenant,
      operationId: input.operationId,
      operation: "remove-relation-property",
      diff: {
        kind: "remove-relation-property",
        propertyDefinition: oldDefinition,
        projection: relationshipProjectionDto(oldProjection),
        removedRelationships: entries,
      },
      context,
    });
    await appendRelationshipEvent(tx, revision, {
      tenant,
      kind: "relationship-projection-removed",
      relationshipTypeId: lockedBundle.type.id,
      relationshipTypeVersionId: lockedBundle.version.id,
      targets: {
        propertyId: oldProjection.propertyId,
        databaseId: oldProjection.databaseId,
      },
      diff: {
        propertyDefinition: oldDefinition,
        projection: relationshipProjectionDto(oldProjection),
      },
    });
    const removedEdgeIds: string[] = [];
    for (const entry of entries) {
      const eventId = nanoid(24);
      const retiredIds = await retireRelationshipActivations(tx, {
        activationIds: entry.observedActivationIds,
        eventId,
        tenant,
        actorEmail: actor.actor.displayName,
      });
      await appendRelationshipEvent(tx, revision, {
        tenant,
        eventId,
        kind: "relationship-removed-with-projection",
        relationshipTypeId: entry.typeId,
        relationshipTypeVersionId: entry.typeVersionId,
        route: entry.route,
        targets: {
          lineageId: entry.edgeId,
          sourcePageId: entry.sourcePageId,
          targetPageId: entry.targetPageId,
        },
        diff: { retiredActivationIds: retiredIds },
      });
      const remaining = await activeActivationIdsForLineages(tx, [
        entry.edgeId,
      ]);
      if ((remaining.get(entry.edgeId)?.length ?? 0) === 0) {
        await tx
          .update(schema.contentRelationshipCardinalitySlots)
          .set({
            lineageId: null,
            targetPageId: null,
            updatedAt: new Date().toISOString(),
          })
          .where(
            and(
              eq(
                schema.contentRelationshipCardinalitySlots.relationshipTypeId,
                entry.typeId,
              ),
              eq(
                schema.contentRelationshipCardinalitySlots.sourcePageId,
                entry.sourcePageId,
              ),
              eq(
                schema.contentRelationshipCardinalitySlots.lineageId,
                entry.edgeId,
              ),
            ),
          );
      }
      removedEdgeIds.push(entry.edgeId);
    }
    const now = new Date().toISOString();
    await tx
      .update(schema.contentRelationshipProjections)
      .set({ archivedAt: now, updatedAt: now })
      .where(eq(schema.contentRelationshipProjections.id, oldProjection.id));
    await tx
      .delete(schema.documentPropertyValues)
      .where(eq(schema.documentPropertyValues.propertyId, input.propertyId));
    await tx
      .delete(schema.contentDatabaseItemKeyClaims)
      .where(
        and(
          eq(
            schema.contentDatabaseItemKeyClaims.databaseId,
            oldProjection.databaseId,
          ),
          eq(schema.contentDatabaseItemKeyClaims.propertyId, input.propertyId),
        ),
      );
    await tx
      .delete(schema.documentPropertyDefinitions)
      .where(eq(schema.documentPropertyDefinitions.id, input.propertyId));
    const [databaseRow] = await tx
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, oldProjection.databaseId));
    if (!databaseRow) {
      relationshipError(
        "CONSTRAINT_UNAVAILABLE",
        "The relation Property database became unavailable.",
        { statusCode: 409 },
      );
    }
    if (selection) {
      await tx
        .update(schema.contentRelationshipRemovalSelections)
        .set({ usedAt: now })
        .where(
          eq(
            schema.contentRelationshipRemovalSelections.token,
            selection.token,
          ),
        );
    }
    const invalidation: RelationshipInvalidation = {
      pageIds: [
        databaseRow.documentId,
        ...entries.flatMap((entry) => [entry.sourcePageId, entry.targetPageId]),
      ]
        .filter((id, index, all) => all.indexOf(id) === index)
        .sort(),
      databaseIds: [oldProjection.databaseId],
      propertyIds: [input.propertyId],
      relationshipTypeIds: [oldProjection.relationshipTypeId],
    };
    const receiptId = nanoid(24);
    const result: RemoveContentRelationPropertyResult = {
      operationId: input.operationId,
      receiptId,
      revisionId: revision.revisionId,
      eventIds: revision.eventIds,
      invalidation,
      propertyId: input.propertyId,
      relationshipTypeId: oldProjection.relationshipTypeId,
      removedEdgeIds: [...new Set(removedEdgeIds)].sort(),
      undo: {
        revisionId: revision.revisionId,
        recoveryToken: revision.recoveryToken,
      },
    };
    await insertRelationshipReceipt(tx, {
      id: receiptId,
      tenant,
      operationId: input.operationId,
      requestHash,
      revisionId: revision.revisionId,
      result,
      context,
    });
    return result;
  });
}

export default defineAction({
  description:
    "Remove one canonical relation Property while preserving its type and, by default, its relationship edges; an exact prepared selection can retire observed edges atomically.",
  mcpTool: true,
  schema: removeContentRelationPropertyInputSchema,
  run: removeContentRelationProperty,
});
