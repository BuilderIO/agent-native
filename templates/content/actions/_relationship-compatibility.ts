import { and, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { parsePropertyOptions } from "../shared/properties.js";
import type {
  CanonicalRelationProjection,
  RelationshipType,
  RelationshipTypeVersion,
} from "../shared/relationships.js";
import { resolveContentDocumentAccess } from "./_content-document-access.js";
import {
  activeActivationIdsForLineages,
  loadRelationshipDatabase,
  relationshipError,
  relationshipProjectionDto,
  relationshipTypeDto,
  relationshipTypeVersionDto,
  type RelationshipDb,
} from "./_relationship-core.js";

export interface ResolvedCanonicalRelationProjection {
  projection: CanonicalRelationProjection;
  relationshipType: RelationshipType;
  relationshipTypeVersion: RelationshipTypeVersion;
}

export async function resolveCanonicalRelationProjection(
  propertyId: string,
  db: RelationshipDb = getDb(),
): Promise<ResolvedCanonicalRelationProjection | null> {
  const [row] = await db
    .select({
      projection: schema.contentRelationshipProjections,
      relationshipType: schema.contentRelationshipTypes,
      relationshipTypeVersion: schema.contentRelationshipTypeVersions,
    })
    .from(schema.contentRelationshipProjections)
    .innerJoin(
      schema.contentRelationshipTypes,
      eq(
        schema.contentRelationshipTypes.id,
        schema.contentRelationshipProjections.relationshipTypeId,
      ),
    )
    .innerJoin(
      schema.contentRelationshipTypeVersions,
      eq(
        schema.contentRelationshipTypeVersions.id,
        schema.contentRelationshipTypes.currentVersionId,
      ),
    )
    .where(eq(schema.contentRelationshipProjections.propertyId, propertyId));
  if (!row) return null;
  return {
    projection: relationshipProjectionDto(row.projection),
    relationshipType: relationshipTypeDto(row.relationshipType),
    relationshipTypeVersion: relationshipTypeVersionDto(
      row.relationshipTypeVersion,
    ),
  };
}

export async function assertCanonicalRelationPropertyValueWrite(args: {
  propertyId: string;
}): Promise<void> {
  const db = getDb();
  const [definition] = await db
    .select({ optionsJson: schema.documentPropertyDefinitions.optionsJson })
    .from(schema.documentPropertyDefinitions)
    .where(eq(schema.documentPropertyDefinitions.id, args.propertyId));
  const marker = parsePropertyOptions(definition?.optionsJson).relation;
  const projection = await resolveCanonicalRelationProjection(
    args.propertyId,
    db,
  );
  if (!marker?.relationshipTypeId && !projection) return;
  if (
    !projection ||
    !marker?.relationshipTypeId ||
    marker.relationshipTypeId !== projection.relationshipType.id ||
    marker.direction !== projection.projection.direction ||
    marker.databaseId !==
      (projection.projection.direction === "forward"
        ? projection.relationshipTypeVersion.targetDatabaseId
        : projection.relationshipTypeVersion.sourceDatabaseId)
  ) {
    relationshipError(
      "UNAVAILABLE",
      "The canonical relation Property metadata is inconsistent.",
      { statusCode: 503 },
    );
  }
  relationshipError(
    "USE_RELATIONSHIP_MUTATION",
    "Canonical relation values must be changed through mutate-content-relationships.",
    { statusCode: 409 },
  );
}

export async function readCanonicalRelationPropertyValue(args: {
  propertyId: string;
  pageId: string;
}): Promise<{
  status: "ready";
  scope: "viewer-accessible";
  pageIds: string[];
}> {
  const resolved = await resolveCanonicalRelationProjection(args.propertyId);
  if (!resolved || resolved.projection.archivedAt) {
    relationshipError(
      "UNSUPPORTED_CONFIGURATION",
      "The property is not an active canonical relation projection.",
    );
  }
  const values = await readCanonicalRelationPropertyValues({
    databaseId: resolved.projection.databaseId,
    pageIds: [args.pageId],
  });
  return {
    status: "ready",
    scope: "viewer-accessible",
    pageIds: values.get(`${args.pageId}\u0000${args.propertyId}`) ?? [],
  };
}

export async function readCanonicalRelationPropertyValues(args: {
  databaseId: string;
  pageIds: string[];
}): Promise<Map<string, string[]>> {
  const pageIds = [...new Set(args.pageIds)].sort();
  const result = new Map<string, string[]>();
  if (pageIds.length === 0) return result;

  await loadRelationshipDatabase(args.databaseId, "viewer");
  const db = getDb();
  const projections = await db
    .select({
      projection: schema.contentRelationshipProjections,
      relationshipType: schema.contentRelationshipTypes,
      relationshipTypeVersion: schema.contentRelationshipTypeVersions,
    })
    .from(schema.contentRelationshipProjections)
    .innerJoin(
      schema.contentRelationshipTypes,
      eq(
        schema.contentRelationshipTypes.id,
        schema.contentRelationshipProjections.relationshipTypeId,
      ),
    )
    .innerJoin(
      schema.contentRelationshipTypeVersions,
      eq(
        schema.contentRelationshipTypeVersions.id,
        schema.contentRelationshipTypes.currentVersionId,
      ),
    )
    .where(
      and(
        eq(schema.contentRelationshipProjections.databaseId, args.databaseId),
        isNull(schema.contentRelationshipProjections.archivedAt),
      ),
    );
  const definitions = await db
    .select({
      id: schema.documentPropertyDefinitions.id,
      optionsJson: schema.documentPropertyDefinitions.optionsJson,
    })
    .from(schema.documentPropertyDefinitions)
    .where(eq(schema.documentPropertyDefinitions.databaseId, args.databaseId));
  const canonicalDefinitions = definitions.flatMap((definition) => {
    const marker = parsePropertyOptions(definition.optionsJson).relation;
    return marker?.relationshipTypeId ? [{ ...definition, marker }] : [];
  });
  const projectionRows = projections.map((row) => row.projection);
  for (const definition of canonicalDefinitions) {
    const row = projections.find(
      (candidate) => candidate.projection.propertyId === definition.id,
    );
    if (
      !row ||
      row.projection.archivedAt ||
      row.projection.relationshipTypeId !==
        definition.marker.relationshipTypeId ||
      row.projection.direction !== definition.marker.direction ||
      row.relationshipType.state !== "active" ||
      (row.projection.direction === "forward"
        ? row.relationshipTypeVersion.targetDatabaseId
        : row.relationshipTypeVersion.sourceDatabaseId) !==
        definition.marker.databaseId
    ) {
      relationshipError(
        "UNAVAILABLE",
        "A canonical relation Property is missing its persisted definition.",
        { statusCode: 503 },
      );
    }
  }
  const projectionsForDatabase = projectionRows.filter(
    (projection) =>
      !projection.archivedAt &&
      canonicalDefinitions.some(
        (definition) => definition.id === projection.propertyId,
      ),
  );
  if (projectionsForDatabase.length === 0) return result;
  for (const pageId of pageIds) {
    for (const projection of projectionsForDatabase) {
      result.set(`${pageId}\u0000${projection.propertyId}`, []);
    }
  }

  const forwardTypeIds = projectionsForDatabase
    .filter((projection) => projection.direction === "forward")
    .map((projection) => projection.relationshipTypeId);
  const inverseTypeIds = projectionsForDatabase
    .filter((projection) => projection.direction === "inverse")
    .map((projection) => projection.relationshipTypeId);
  const lineages = await db
    .select()
    .from(schema.contentRelationshipLineages)
    .where(
      or(
        forwardTypeIds.length
          ? and(
              inArray(
                schema.contentRelationshipLineages.relationshipTypeId,
                forwardTypeIds,
              ),
              inArray(schema.contentRelationshipLineages.sourcePageId, pageIds),
            )
          : undefined,
        inverseTypeIds.length
          ? and(
              inArray(
                schema.contentRelationshipLineages.relationshipTypeId,
                inverseTypeIds,
              ),
              inArray(schema.contentRelationshipLineages.targetPageId, pageIds),
            )
          : undefined,
      ),
    );
  const activeByLineage = await activeActivationIdsForLineages(
    db,
    lineages.map((lineage) => lineage.id),
  );
  const liveLineages = lineages.filter(
    (lineage) => (activeByLineage.get(lineage.id)?.length ?? 0) > 0,
  );
  if (liveLineages.length === 0) return result;

  const endpointIds = [
    ...new Set(
      liveLineages.flatMap((lineage) => [
        lineage.sourcePageId,
        lineage.targetPageId,
      ]),
    ),
  ];
  const documents = await db
    .select({ id: schema.documents.id, trashedAt: schema.documents.trashedAt })
    .from(schema.documents)
    .where(
      and(
        inArray(schema.documents.id, endpointIds),
        isNull(schema.documents.trashedAt),
      ),
    );
  const activeDocuments = new Set(documents.map((document) => document.id));
  const permanentlyDeleted = await db
    .select({ pageId: schema.contentRelationshipEndpointStates.pageId })
    .from(schema.contentRelationshipEndpointStates)
    .where(
      and(
        inArray(schema.contentRelationshipEndpointStates.pageId, endpointIds),
        isNotNull(
          schema.contentRelationshipEndpointStates.permanentlyDeletedAt,
        ),
      ),
    );
  const deletedPageIds = new Set(
    permanentlyDeleted.map((state) => state.pageId),
  );
  const accessByPageId = new Map<string, boolean>();
  await Promise.all(
    endpointIds.map(async (pageId) => {
      if (!activeDocuments.has(pageId)) {
        accessByPageId.set(pageId, false);
        return;
      }
      if (deletedPageIds.has(pageId)) {
        accessByPageId.set(pageId, false);
        return;
      }
      accessByPageId.set(
        pageId,
        Boolean(await resolveContentDocumentAccess(pageId)),
      );
    }),
  );

  const projectionsByTypeDirection = new Map<
    string,
    typeof projectionsForDatabase
  >();
  for (const projection of projectionsForDatabase) {
    const key = `${projection.relationshipTypeId}\u0000${projection.direction}`;
    projectionsByTypeDirection.set(key, [
      ...(projectionsByTypeDirection.get(key) ?? []),
      projection,
    ]);
  }
  for (const lineage of liveLineages) {
    if (
      !accessByPageId.get(lineage.sourcePageId) ||
      !accessByPageId.get(lineage.targetPageId)
    ) {
      continue;
    }
    const forwards =
      projectionsByTypeDirection.get(
        `${lineage.relationshipTypeId}\u0000forward`,
      ) ?? [];
    if (pageIds.includes(lineage.sourcePageId)) {
      for (const forward of forwards) {
        const key = `${lineage.sourcePageId}\u0000${forward.propertyId}`;
        result.set(key, [
          ...new Set([...(result.get(key) ?? []), lineage.targetPageId]),
        ]);
      }
    }
    const inverses =
      projectionsByTypeDirection.get(
        `${lineage.relationshipTypeId}\u0000inverse`,
      ) ?? [];
    if (pageIds.includes(lineage.targetPageId)) {
      for (const inverse of inverses) {
        const key = `${lineage.targetPageId}\u0000${inverse.propertyId}`;
        result.set(key, [
          ...new Set([...(result.get(key) ?? []), lineage.sourcePageId]),
        ]);
      }
    }
  }
  for (const ids of result.values()) ids.sort();
  return result;
}
