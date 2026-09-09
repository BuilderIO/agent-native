import type { ActionRunContext } from "@agent-native/core/action";
import { and, inArray, isNotNull, or } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import {
  appendRelationshipEvent,
  createRelationshipRevision,
  lockRelationshipLineages,
  lockRelationshipTypes,
  relationshipError,
  type RelationshipDb,
} from "./_relationship-core.js";

export interface RelationshipDocumentLifecycleResult {
  revisionId: string | null;
  eventIds: string[];
  incidentTypeIds: string[];
  incidentPageIds: string[];
}

export async function getDocumentRelationshipLifecycleImpact(args: {
  documentIds: string[];
  db?: RelationshipDb;
}): Promise<{
  incidentTypeIds: string[];
  incidentPageIds: string[];
  lineageIds: string[];
}> {
  const db = args.db ?? getDb();
  const documentIds = [...new Set(args.documentIds)].sort();
  if (documentIds.length === 0) {
    return { incidentTypeIds: [], incidentPageIds: [], lineageIds: [] };
  }
  const lineages = await db
    .select({
      id: schema.contentRelationshipLineages.id,
      relationshipTypeId: schema.contentRelationshipLineages.relationshipTypeId,
      sourcePageId: schema.contentRelationshipLineages.sourcePageId,
      targetPageId: schema.contentRelationshipLineages.targetPageId,
    })
    .from(schema.contentRelationshipLineages)
    .where(
      or(
        inArray(schema.contentRelationshipLineages.sourcePageId, documentIds),
        inArray(schema.contentRelationshipLineages.targetPageId, documentIds),
      ),
    );
  return {
    incidentTypeIds: [
      ...new Set(lineages.map((lineage) => lineage.relationshipTypeId)),
    ].sort(),
    incidentPageIds: [
      ...new Set(
        lineages.flatMap((lineage) => [
          lineage.sourcePageId,
          lineage.targetPageId,
        ]),
      ),
    ].sort(),
    lineageIds: lineages.map((lineage) => lineage.id).sort(),
  };
}

export async function assertDocumentRelationshipPermanentDeleteAllowed(
  db: RelationshipDb,
  args: { documentIds: string[] },
): Promise<void> {
  const documentIds = [...new Set(args.documentIds)].sort();
  if (documentIds.length === 0) return;
  const [alreadyDeleted] = await db
    .select({ pageId: schema.contentRelationshipEndpointStates.pageId })
    .from(schema.contentRelationshipEndpointStates)
    .where(
      and(
        inArray(schema.contentRelationshipEndpointStates.pageId, documentIds),
        isNotNull(
          schema.contentRelationshipEndpointStates.permanentlyDeletedAt,
        ),
      ),
    )
    .limit(1);
  if (alreadyDeleted) {
    relationshipError(
      "STALE_RECOVERY",
      "A permanently deleted relationship endpoint cannot be restored.",
      { statusCode: 409 },
    );
  }
}

export async function applyRelationshipDocumentLifecycleInsideTransaction(
  db: RelationshipDb,
  args: {
    documentIds: string[];
    operation: "trash" | "restore" | "permanent-delete";
    operationId: string;
    context?: ActionRunContext;
  },
): Promise<RelationshipDocumentLifecycleResult> {
  const documentIds = [...new Set(args.documentIds)].sort();
  if (documentIds.length === 0) {
    return {
      revisionId: null,
      eventIds: [],
      incidentTypeIds: [],
      incidentPageIds: [],
    };
  }
  if (args.operation === "restore") {
    const [permanentlyDeleted] = await db
      .select({ pageId: schema.contentRelationshipEndpointStates.pageId })
      .from(schema.contentRelationshipEndpointStates)
      .where(
        and(
          inArray(schema.contentRelationshipEndpointStates.pageId, documentIds),
          isNotNull(
            schema.contentRelationshipEndpointStates.permanentlyDeletedAt,
          ),
        ),
      )
      .limit(1);
    if (permanentlyDeleted) {
      relationshipError(
        "STALE_RECOVERY",
        "A permanently deleted relationship endpoint cannot be restored.",
        { statusCode: 409 },
      );
    }
  }

  const lineages = await db
    .select()
    .from(schema.contentRelationshipLineages)
    .where(
      or(
        inArray(schema.contentRelationshipLineages.sourcePageId, documentIds),
        inArray(schema.contentRelationshipLineages.targetPageId, documentIds),
      ),
    );
  if (lineages.length === 0) {
    return {
      revisionId: null,
      eventIds: [],
      incidentTypeIds: [],
      incidentPageIds: [],
    };
  }
  const spaces = new Set(lineages.map((lineage) => lineage.spaceId));
  if (spaces.size !== 1) {
    relationshipError(
      "UNAVAILABLE",
      "The relationship lifecycle scope crosses Content spaces.",
      { statusCode: 503 },
    );
  }
  const first = lineages[0]!;
  const tenant = {
    ownerEmail: first.ownerEmail,
    orgId: first.orgId,
    spaceId: first.spaceId,
  };
  const typeIds = [
    ...new Set(lineages.map((lineage) => lineage.relationshipTypeId)),
  ].sort();
  await lockRelationshipTypes(db, typeIds);
  await lockRelationshipLineages(
    db,
    lineages.map((lineage) => lineage.id),
  );

  const now = new Date().toISOString();
  if (args.operation === "permanent-delete") {
    const affectedDocumentIds = documentIds.filter((documentId) =>
      lineages.some(
        (lineage) =>
          lineage.sourcePageId === documentId ||
          lineage.targetPageId === documentId,
      ),
    );
    for (const pageId of affectedDocumentIds) {
      await db
        .insert(schema.contentRelationshipEndpointStates)
        .values({
          pageId,
          ownerEmail: tenant.ownerEmail,
          orgId: tenant.orgId,
          spaceId: tenant.spaceId,
          permanentlyDeletedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: schema.contentRelationshipEndpointStates.pageId,
          set: { permanentlyDeletedAt: now, updatedAt: now },
        });
    }
  }

  const revision = await createRelationshipRevision(db, {
    tenant,
    operationId: args.operationId,
    operation: `document-${args.operation}`,
    diff: {
      operation: args.operation,
      documentIds,
      lineageIds: lineages.map((lineage) => lineage.id).sort(),
    },
    context: args.context,
  });
  const versions = await db
    .select({
      typeId: schema.contentRelationshipTypes.id,
      versionId: schema.contentRelationshipTypes.currentVersionId,
    })
    .from(schema.contentRelationshipTypes)
    .where(inArray(schema.contentRelationshipTypes.id, typeIds));
  const versionByTypeId = new Map(
    versions.map((version) => [version.typeId, version.versionId]),
  );
  for (const lineage of [...lineages].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    await appendRelationshipEvent(db, revision, {
      tenant,
      kind: `relationship-endpoint-${args.operation}`,
      relationshipTypeId: lineage.relationshipTypeId,
      relationshipTypeVersionId:
        versionByTypeId.get(lineage.relationshipTypeId) ?? null,
      targets: {
        lineageId: lineage.id,
        sourcePageId: lineage.sourcePageId,
        targetPageId: lineage.targetPageId,
        affectedPageIds: documentIds.filter(
          (id) => id === lineage.sourcePageId || id === lineage.targetPageId,
        ),
      },
      diff: { state: args.operation },
    });
  }
  return {
    revisionId: revision.revisionId,
    eventIds: revision.eventIds,
    incidentTypeIds: typeIds,
    incidentPageIds: [
      ...new Set(
        lineages.flatMap((lineage) => [
          lineage.sourcePageId,
          lineage.targetPageId,
        ]),
      ),
    ].sort(),
  };
}
