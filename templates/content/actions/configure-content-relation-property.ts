import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { and, eq, isNull, sql } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import {
  configureContentRelationPropertyInputSchema,
  type CanonicalRelationProjection,
  type ConfigureContentRelationPropertyInput,
  type ConfigureContentRelationPropertyResult,
} from "../shared/relationships.js";
import { lockContentDatabaseMutation } from "./_content-database-mutation-lock.js";
import { nanoid } from "./_property-utils.js";
import {
  appendRelationshipEvent,
  assertSameRelationshipTenant,
  createRelationshipRevision,
  insertRelationshipReceipt,
  loadRelationshipDatabase,
  loadRelationshipTypeBundle,
  lockRelationshipOperation,
  lockRelationshipTypes,
  relationshipCapabilities,
  relationshipActorContext,
  relationshipError,
  relationshipProjectionDto,
  relationshipRequestHash,
  relationshipTenant,
  relationshipTypeDto,
  relationshipTypeVersionDto,
  replayRelationshipReceipt,
  type RelationshipDb,
} from "./_relationship-core.js";

async function nextPropertyPosition(
  db: RelationshipDb,
  databaseId: string,
): Promise<number> {
  const [row] = await db
    .select({
      value: sql<number>`coalesce(max(${schema.documentPropertyDefinitions.position}), -1)`,
    })
    .from(schema.documentPropertyDefinitions)
    .where(eq(schema.documentPropertyDefinitions.databaseId, databaseId));
  return Number(row?.value ?? -1) + 1;
}

function projectionOptions(args: {
  oppositeDatabaseId: string;
  relationshipTypeId: string;
  direction: "forward" | "inverse";
  editable: boolean;
}): string {
  return JSON.stringify({
    relation: {
      databaseId: args.oppositeDatabaseId,
      relationshipTypeId: args.relationshipTypeId,
      direction: args.direction,
      editable: args.editable,
    },
  });
}

async function persistProjection(
  tx: RelationshipDb,
  args: {
    propertyId?: string;
    database: typeof schema.contentDatabases.$inferSelect;
    typeId: string;
    direction: "forward" | "inverse";
    oppositeDatabaseId: string;
    alias: string;
    description?: string;
    editable: boolean;
    visibility?: "always_show" | "hide_when_empty" | "always_hide";
    actorEmail: string;
  },
): Promise<typeof schema.contentRelationshipProjections.$inferSelect> {
  const propertyId = args.propertyId ?? nanoid(18);
  const [existingProjection] = await tx
    .select()
    .from(schema.contentRelationshipProjections)
    .where(eq(schema.contentRelationshipProjections.propertyId, propertyId));
  const [existingDefinition] = await tx
    .select()
    .from(schema.documentPropertyDefinitions)
    .where(eq(schema.documentPropertyDefinitions.id, propertyId));
  if (existingProjection) {
    if (
      existingProjection.databaseId !== args.database.id ||
      existingProjection.relationshipTypeId !== args.typeId ||
      existingProjection.direction !== args.direction ||
      !existingDefinition
    ) {
      relationshipError(
        "INVALID_TARGET",
        "The requested relation Property ID belongs to a different projection.",
        { statusCode: 409 },
      );
    }
    const now = new Date().toISOString();
    const description = args.description ?? existingProjection.description;
    await tx
      .update(schema.contentRelationshipProjections)
      .set({
        alias: args.alias,
        description,
        editable: args.editable ? 1 : 0,
        archivedAt: null,
        updatedAt: now,
      })
      .where(
        eq(schema.contentRelationshipProjections.id, existingProjection.id),
      );
    await tx
      .update(schema.documentPropertyDefinitions)
      .set({
        name: args.alias,
        description,
        type: "relation",
        optionsJson: projectionOptions({
          oppositeDatabaseId: args.oppositeDatabaseId,
          relationshipTypeId: args.typeId,
          direction: args.direction,
          editable: args.editable,
        }),
        ...(args.visibility ? { visibility: args.visibility } : {}),
        updatedAt: now,
      })
      .where(eq(schema.documentPropertyDefinitions.id, propertyId));
    return {
      ...existingProjection,
      alias: args.alias,
      description,
      editable: args.editable ? 1 : 0,
      archivedAt: null,
      updatedAt: now,
    };
  }
  if (existingDefinition) {
    relationshipError(
      "INVALID_TARGET",
      "The requested Property ID already belongs to another property.",
      { statusCode: 409 },
    );
  }
  const projectionId = nanoid(18);
  const position = await nextPropertyPosition(tx, args.database.id);
  await tx.insert(schema.documentPropertyDefinitions).values({
    id: propertyId,
    ownerEmail: args.database.ownerEmail,
    orgId: args.database.orgId,
    databaseId: args.database.id,
    name: args.alias,
    type: "relation",
    description: args.description ?? "",
    ...(args.visibility ? { visibility: args.visibility } : {}),
    optionsJson: projectionOptions({
      oppositeDatabaseId: args.oppositeDatabaseId,
      relationshipTypeId: args.typeId,
      direction: args.direction,
      editable: args.editable,
    }),
    position,
  });
  await tx.insert(schema.contentRelationshipProjections).values({
    id: projectionId,
    ownerEmail: args.database.ownerEmail,
    orgId: args.database.orgId,
    spaceId: args.database.spaceId!,
    propertyId,
    databaseId: args.database.id,
    relationshipTypeId: args.typeId,
    direction: args.direction,
    editable: args.editable ? 1 : 0,
    alias: args.alias,
    description: args.description ?? "",
    createdBy: args.actorEmail,
  });
  const [created] = await tx
    .select()
    .from(schema.contentRelationshipProjections)
    .where(eq(schema.contentRelationshipProjections.id, projectionId));
  if (!created) {
    relationshipError(
      "UNAVAILABLE",
      "The relation projection was not committed.",
      {
        statusCode: 503,
      },
    );
  }
  return created;
}

async function configureContentRelationProperty(
  args: ConfigureContentRelationPropertyInput,
  context?: ActionRunContext,
): Promise<ConfigureContentRelationPropertyResult> {
  const ownerContext = await loadRelationshipDatabase(
    args.ownerDatabaseId,
    "admin",
    getDb(),
    context,
  );
  let sourceContext;
  let targetContext;
  if (args.definition.kind === "new-local") {
    if (args.ownerDatabaseId !== args.definition.sourceDatabaseId) {
      relationshipError(
        "INVALID_TARGET",
        "A new forward relation Property must be owned by its source database.",
      );
    }
    sourceContext = ownerContext;
    targetContext = await loadRelationshipDatabase(
      args.definition.targetDatabaseId,
      args.inverseProjection ? "admin" : "viewer",
      getDb(),
      context,
    );
    assertSameRelationshipTenant(
      sourceContext.database,
      targetContext.database,
    );
  } else {
    const bundle = await loadRelationshipTypeBundle(
      args.definition.relationshipTypeId,
    );
    const expectedOwnerDatabaseId =
      args.definition.direction === "forward"
        ? bundle.version.sourceDatabaseId
        : bundle.version.targetDatabaseId;
    if (ownerContext.database.id !== expectedOwnerDatabaseId) {
      relationshipError(
        "INVALID_TARGET",
        "The Property owner does not match the selected relationship direction.",
      );
    }
    sourceContext =
      args.definition.direction === "forward"
        ? ownerContext
        : await loadRelationshipDatabase(
            bundle.version.sourceDatabaseId,
            "viewer",
            getDb(),
            context,
          );
    targetContext =
      args.definition.direction === "inverse"
        ? ownerContext
        : await loadRelationshipDatabase(
            bundle.version.targetDatabaseId,
            args.inverseProjection ? "admin" : "viewer",
            getDb(),
            context,
          );
    assertSameRelationshipTenant(
      sourceContext.database,
      targetContext.database,
    );
  }
  if (sourceContext.database.systemRole || targetContext.database.systemRole) {
    relationshipError(
      "UNSUPPORTED_CONFIGURATION",
      "Typed relationships currently support ordinary Content databases only.",
    );
  }
  if (
    args.inverseProjection &&
    args.inverseProjection.ownerDatabaseId !== targetContext.database.id
  ) {
    relationshipError(
      "INVALID_TARGET",
      "The inverse projection must be owned by the target database.",
    );
  }

  const requestHash = relationshipRequestHash(args);
  const actor = relationshipActorContext(context);
  const db = getDb();
  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as RelationshipDb;
    await lockRelationshipOperation(tx, {
      tenant: relationshipTenant(sourceContext.database),
      operationId: args.operationId,
      context,
    });
    const lockedDatabaseIds = [
      ...new Set([sourceContext.database.id, targetContext.database.id]),
    ].sort();
    for (const databaseId of lockedDatabaseIds) {
      await lockContentDatabaseMutation(tx, databaseId);
    }
    await loadRelationshipDatabase(args.ownerDatabaseId, "admin", tx, context);
    await loadRelationshipDatabase(
      sourceContext.database.id,
      "viewer",
      tx,
      context,
    );
    await loadRelationshipDatabase(
      targetContext.database.id,
      args.inverseProjection ? "admin" : "viewer",
      tx,
      context,
    );
    const replayed =
      await replayRelationshipReceipt<ConfigureContentRelationPropertyResult>(
        tx,
        {
          spaceId: sourceContext.database.spaceId!,
          operationId: args.operationId,
          requestHash,
          context,
        },
      );
    if (replayed) return replayed;

    const [lockedSource] = await tx
      .select()
      .from(schema.contentDatabases)
      .where(
        and(
          eq(schema.contentDatabases.id, sourceContext.database.id),
          isNull(schema.contentDatabases.deletedAt),
        ),
      );
    const [lockedTarget] = await tx
      .select()
      .from(schema.contentDatabases)
      .where(
        and(
          eq(schema.contentDatabases.id, targetContext.database.id),
          isNull(schema.contentDatabases.deletedAt),
        ),
      );
    if (!lockedSource || !lockedTarget) {
      relationshipError(
        "CONSTRAINT_UNAVAILABLE",
        "A relationship database became unavailable.",
        { statusCode: 409 },
      );
    }
    assertSameRelationshipTenant(lockedSource, lockedTarget);

    let typeRow: typeof schema.contentRelationshipTypes.$inferSelect;
    let versionRow: typeof schema.contentRelationshipTypeVersions.$inferSelect;
    if (args.definition.kind === "new-local") {
      const typeId = nanoid(18);
      const versionId = nanoid(18);
      await tx.insert(schema.contentRelationshipTypes).values({
        id: typeId,
        ownerEmail: lockedSource.ownerEmail,
        orgId: lockedSource.orgId,
        spaceId: lockedSource.spaceId!,
        currentVersionId: versionId,
        createdBy: actor.actor.displayName,
      });
      await tx.insert(schema.contentRelationshipTypeVersions).values({
        id: versionId,
        ownerEmail: lockedSource.ownerEmail,
        orgId: lockedSource.orgId,
        spaceId: lockedSource.spaceId!,
        relationshipTypeId: typeId,
        version: 1,
        forwardLabel: args.definition.forwardLabel,
        inverseLabel: args.definition.inverseLabel,
        forwardCardinality: args.definition.forwardCardinality,
        sourceDatabaseId: lockedSource.id,
        targetDatabaseId: lockedTarget.id,
        createdBy: actor.actor.displayName,
      });
      [typeRow] = await tx
        .select()
        .from(schema.contentRelationshipTypes)
        .where(eq(schema.contentRelationshipTypes.id, typeId));
      [versionRow] = await tx
        .select()
        .from(schema.contentRelationshipTypeVersions)
        .where(eq(schema.contentRelationshipTypeVersions.id, versionId));
    } else {
      await lockRelationshipTypes(tx, [args.definition.relationshipTypeId]);
      const bundle = await loadRelationshipTypeBundle(
        args.definition.relationshipTypeId,
        { db: tx },
      );
      typeRow = bundle.type;
      versionRow = bundle.version;
    }
    if (!typeRow! || !versionRow!) {
      relationshipError(
        "UNAVAILABLE",
        "The relationship type was not committed.",
        {
          statusCode: 503,
        },
      );
    }
    const direction =
      args.definition.kind === "new-local"
        ? "forward"
        : args.definition.direction;
    const ownerDatabase = direction === "forward" ? lockedSource : lockedTarget;
    const oppositeDatabase =
      direction === "forward" ? lockedTarget : lockedSource;
    const [existingPrimaryProjection] = args.propertyId
      ? await tx
          .select({ editable: schema.contentRelationshipProjections.editable })
          .from(schema.contentRelationshipProjections)
          .where(
            eq(
              schema.contentRelationshipProjections.propertyId,
              args.propertyId,
            ),
          )
      : [];
    if (direction === "forward" && args.editable === false) {
      relationshipError(
        "UNSUPPORTED_CONFIGURATION",
        "Forward relation Properties are editable in this relationship slice.",
      );
    }
    const primaryRow = await persistProjection(tx, {
      propertyId: args.propertyId,
      database: ownerDatabase,
      typeId: typeRow.id,
      direction,
      oppositeDatabaseId: oppositeDatabase.id,
      alias: args.alias,
      description: args.description,
      editable:
        direction === "forward"
          ? true
          : (args.editable ?? existingPrimaryProjection?.editable === 1),
      visibility: args.visibility,
      actorEmail: actor.actor.displayName,
    });
    let inverseRow:
      | typeof schema.contentRelationshipProjections.$inferSelect
      | undefined;
    if (args.inverseProjection) {
      inverseRow = await persistProjection(tx, {
        propertyId: args.inverseProjection.propertyId,
        database: lockedTarget,
        typeId: typeRow.id,
        direction: "inverse",
        oppositeDatabaseId: lockedSource.id,
        alias: args.inverseProjection.alias,
        description: args.inverseProjection.description,
        editable: args.inverseProjection.editable,
        visibility: args.inverseProjection.visibility,
        actorEmail: actor.actor.displayName,
      });
    }
    const tenant = relationshipTenant(lockedSource);
    const projectionDtos: CanonicalRelationProjection[] = [
      relationshipProjectionDto(primaryRow),
      ...(inverseRow ? [relationshipProjectionDto(inverseRow)] : []),
    ];
    const revision = await createRelationshipRevision(tx, {
      tenant,
      operationId: args.operationId,
      operation: "configure-relation-property",
      diff: {
        relationshipTypeId: typeRow.id,
        relationshipTypeVersionId: versionRow.id,
        projections: projectionDtos,
      },
      context,
    });
    await appendRelationshipEvent(tx, revision, {
      tenant,
      kind: "relationship-projection-configured",
      relationshipTypeId: typeRow.id,
      relationshipTypeVersionId: versionRow.id,
      targets: {
        propertyIds: projectionDtos.map((projection) => projection.propertyId),
        databaseIds: projectionDtos.map((projection) => projection.databaseId),
      },
      diff: { projections: projectionDtos },
    });
    const receiptId = nanoid(24);
    const schemaRevision = relationshipRequestHash({
      typeId: typeRow.id,
      versionId: versionRow.id,
      projections: projectionDtos,
      revisionId: revision.revisionId,
    });
    const result: ConfigureContentRelationPropertyResult = {
      operationId: args.operationId,
      receiptId,
      revisionId: revision.revisionId,
      eventIds: revision.eventIds,
      relationshipType: relationshipTypeDto(typeRow),
      relationshipTypeVersion: relationshipTypeVersionDto(versionRow),
      projection: relationshipProjectionDto(primaryRow),
      ...(inverseRow
        ? { inverseProjection: relationshipProjectionDto(inverseRow) }
        : {}),
      capabilities: relationshipCapabilities({
        databaseRole: ownerContext.role,
        pageRole: ownerContext.role,
        direction,
        editable: primaryRow.editable === 1,
        cardinality: versionRow.forwardCardinality === "one" ? "one" : "many",
      }),
      schemaRevision,
      invalidation: {
        pageIds: [lockedSource.documentId, lockedTarget.documentId],
        databaseIds: [lockedSource.id, lockedTarget.id].sort(),
        propertyIds: projectionDtos
          .map((projection) => projection.propertyId)
          .sort(),
        relationshipTypeIds: [typeRow.id],
      },
    };
    await insertRelationshipReceipt(tx, {
      id: receiptId,
      tenant,
      operationId: args.operationId,
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
    "Create or update one canonical typed Content relation Property and an optional inverse projection.",
  mcpTool: true,
  schema: configureContentRelationPropertyInputSchema,
  run: configureContentRelationProperty,
});
