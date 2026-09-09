import {
  isActionContractError,
  type ActionRunContext,
} from "@agent-native/core/action";
import { and, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import type {
  ContentRelationshipItem,
  ListContentRelationshipsInput,
  ListContentRelationshipsResult,
  RelationshipRouteRef,
} from "../shared/relationships.js";
import { nanoid } from "./_property-utils.js";
import { authorizeRelationshipRoute } from "./_relationship-authority.js";
import {
  activeActivationIdsForLineages,
  decodeRelationshipCursor,
  encodeRelationshipCursor,
  loadRelationshipDatabase,
  loadRelationshipTypeBundle,
  relationshipActorContext,
  relationshipError,
  resolveRelationshipDocumentAccess,
  type RelationshipDb,
  type RelationshipTypeBundle,
} from "./_relationship-core.js";

const OBSERVATION_TTL_MS = 15 * 60 * 1_000;

export async function issueRelationshipObservation(
  db: RelationshipDb,
  args: {
    kind: "edge" | "slot";
    edgeId?: string | null;
    relationshipTypeId: string;
    sourcePageId: string;
    activationIds: string[];
    tenant: { ownerEmail: string; orgId: string | null; spaceId: string };
    context?: ActionRunContext;
  },
): Promise<string> {
  const actor = relationshipActorContext(args.context);
  const token = nanoid(32);
  await db.insert(schema.contentRelationshipObservations).values({
    token,
    ownerEmail: args.tenant.ownerEmail,
    orgId: args.tenant.orgId,
    spaceId: args.tenant.spaceId,
    callerScope: actor.callerScope,
    kind: args.kind,
    edgeId: args.edgeId ?? null,
    relationshipTypeId: args.relationshipTypeId,
    sourcePageId: args.sourcePageId,
    activationIdsJson: JSON.stringify([...new Set(args.activationIds)].sort()),
    expiresAt: new Date(Date.now() + OBSERVATION_TTL_MS).toISOString(),
  });
  return token;
}

export async function availableRelationshipRoutes(
  db: RelationshipDb,
  args: {
    bundle: RelationshipTypeBundle;
    sourcePageId: string;
    targetPageId: string;
    context?: ActionRunContext;
  },
): Promise<RelationshipRouteRef[]> {
  const candidateRoutes: RelationshipRouteRef[] = [
    { kind: "connections-forward", sourcePageId: args.sourcePageId },
  ];
  const projections = await db
    .select()
    .from(schema.contentRelationshipProjections)
    .where(
      and(
        eq(
          schema.contentRelationshipProjections.relationshipTypeId,
          args.bundle.type.id,
        ),
        isNull(schema.contentRelationshipProjections.archivedAt),
      ),
    );
  for (const projection of projections) {
    candidateRoutes.push(
      projection.direction === "inverse"
        ? {
            kind: "inverse-property",
            propertyId: projection.propertyId,
            targetPageId: args.targetPageId,
          }
        : {
            kind: "forward-property",
            propertyId: projection.propertyId,
            sourcePageId: args.sourcePageId,
          },
    );
  }
  const result: RelationshipRouteRef[] = [];
  for (const route of candidateRoutes) {
    try {
      await authorizeRelationshipRoute({
        db,
        bundle: args.bundle,
        sourcePageId: args.sourcePageId,
        targetPageId: args.targetPageId,
        route,
        operation: "remove",
        context: args.context,
      });
      result.push(route);
    } catch (error) {
      // A route is omitted rather than returning a denied capability. Ambient
      // reads must not reveal an inaccessible projection or endpoint.
      if (
        !isActionContractError(error) ||
        ![
          "NOT_ACCESSIBLE",
          "ROUTE_NOT_AUTHORIZED",
          "SOURCE_AUTHORITY_UNSUPPORTED",
        ].includes(error.errorCode)
      ) {
        throw error;
      }
    }
  }
  return result;
}

export async function listContentRelationships(
  input: ListContentRelationshipsInput,
  context?: ActionRunContext,
): Promise<ListContentRelationshipsResult> {
  const db = getDb();
  let anchorPageIds: string[];
  if (input.pageId) {
    const access = await resolveRelationshipDocumentAccess(input.pageId, {
      db,
      context,
    });
    if (!access) {
      relationshipError(
        "NOT_ACCESSIBLE",
        "The requested Content Page is not accessible.",
        { statusCode: 404 },
      );
    }
    anchorPageIds = [input.pageId];
  } else {
    const database = await loadRelationshipDatabase(
      input.databaseId!,
      "viewer",
      db,
    );
    anchorPageIds = (
      await db
        .select({ documentId: schema.contentDatabaseItems.documentId })
        .from(schema.contentDatabaseItems)
        .where(eq(schema.contentDatabaseItems.databaseId, database.database.id))
    ).map((membership) => membership.documentId);
  }
  if (input.oppositePageId) {
    const oppositeAccess = await resolveRelationshipDocumentAccess(
      input.oppositePageId,
      { db, context },
    );
    if (!oppositeAccess) {
      relationshipError(
        "NOT_ACCESSIBLE",
        "The requested opposite Content Page is not accessible.",
        { statusCode: 404 },
      );
    }
  }
  if (anchorPageIds.length === 0) {
    return { scope: "viewer-accessible", items: [], nextCursor: null };
  }
  const outgoing = input.direction === "outgoing" || input.direction === "both";
  const incoming = input.direction === "incoming" || input.direction === "both";
  const lineages = await db
    .select()
    .from(schema.contentRelationshipLineages)
    .where(
      and(
        input.relationshipTypeId
          ? eq(
              schema.contentRelationshipLineages.relationshipTypeId,
              input.relationshipTypeId,
            )
          : undefined,
        input.oppositePageId
          ? or(
              eq(
                schema.contentRelationshipLineages.sourcePageId,
                input.oppositePageId,
              ),
              eq(
                schema.contentRelationshipLineages.targetPageId,
                input.oppositePageId,
              ),
            )
          : undefined,
        or(
          outgoing
            ? inArray(
                schema.contentRelationshipLineages.sourcePageId,
                anchorPageIds,
              )
            : undefined,
          incoming
            ? inArray(
                schema.contentRelationshipLineages.targetPageId,
                anchorPageIds,
              )
            : undefined,
        ),
      ),
    );
  const activeByLineage = await activeActivationIdsForLineages(
    db,
    lineages.map((lineage) => lineage.id),
  );
  const liveLineages = lineages.filter(
    (lineage) => (activeByLineage.get(lineage.id)?.length ?? 0) > 0,
  );
  if (liveLineages.length === 0) {
    return { scope: "viewer-accessible", items: [], nextCursor: null };
  }
  const endpointIds = [
    ...new Set(
      liveLineages.flatMap((lineage) => [
        lineage.sourcePageId,
        lineage.targetPageId,
      ]),
    ),
  ];
  const deletedStates = await db
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
  const deletedIds = new Set(deletedStates.map((state) => state.pageId));
  const accessByPageId = new Map<string, boolean>();
  const documentById = new Map<string, typeof schema.documents.$inferSelect>();
  for (const pageId of endpointIds) {
    const access = deletedIds.has(pageId)
      ? null
      : await resolveRelationshipDocumentAccess(pageId, { db, context });
    accessByPageId.set(pageId, Boolean(access));
    if (access) documentById.set(pageId, access.resource);
  }
  const bundleByTypeId = new Map<string, RelationshipTypeBundle>();
  for (const typeId of [
    ...new Set(liveLineages.map((lineage) => lineage.relationshipTypeId)),
  ]) {
    const bundle = await loadRelationshipTypeBundle(typeId, {
      allowArchived: true,
      db,
    });
    try {
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
    } catch (error) {
      if (
        isActionContractError(error) &&
        error.errorCode === "NOT_ACCESSIBLE"
      ) {
        continue;
      }
      throw error;
    }
    bundleByTypeId.set(typeId, bundle);
  }
  const anchorSet = new Set(anchorPageIds);
  const authorized: Array<{
    lineage: (typeof liveLineages)[number];
    bundle: RelationshipTypeBundle;
    direction: "outgoing" | "incoming";
    routes: RelationshipRouteRef[];
  }> = [];
  for (const lineage of liveLineages) {
    if (
      !accessByPageId.get(lineage.sourcePageId) ||
      !accessByPageId.get(lineage.targetPageId)
    ) {
      continue;
    }
    const bundle = bundleByTypeId.get(lineage.relationshipTypeId);
    if (!bundle) continue;
    const isOutgoing = anchorSet.has(lineage.sourcePageId);
    const direction = isOutgoing ? "outgoing" : "incoming";
    if (
      input.oppositePageId &&
      (isOutgoing
        ? lineage.targetPageId !== input.oppositePageId
        : lineage.sourcePageId !== input.oppositePageId)
    ) {
      continue;
    }
    authorized.push({
      lineage,
      bundle,
      direction,
      routes: await availableRelationshipRoutes(db, {
        bundle,
        sourcePageId: lineage.sourcePageId,
        targetPageId: lineage.targetPageId,
        context,
      }),
    });
  }
  authorized.sort((left, right) =>
    left.lineage.id.localeCompare(right.lineage.id),
  );
  const offset = decodeRelationshipCursor(input.cursor);
  const page = authorized.slice(offset, offset + input.limit);
  const items: ContentRelationshipItem[] = [];
  for (const entry of page) {
    const { lineage, bundle, direction } = entry;
    const activationIds = activeByLineage.get(lineage.id) ?? [];
    const tenant = {
      ownerEmail: bundle.type.ownerEmail,
      orgId: bundle.type.orgId,
      spaceId: bundle.type.spaceId,
    };
    const observationToken = await issueRelationshipObservation(db, {
      kind: "edge",
      edgeId: lineage.id,
      relationshipTypeId: lineage.relationshipTypeId,
      sourcePageId: lineage.sourcePageId,
      activationIds,
      tenant,
      context,
    });
    let slotObservationToken: string | null = null;
    if (bundle.version.forwardCardinality === "one") {
      const slotLineages = liveLineages.filter(
        (candidate) =>
          candidate.relationshipTypeId === lineage.relationshipTypeId &&
          candidate.sourcePageId === lineage.sourcePageId,
      );
      slotObservationToken = await issueRelationshipObservation(db, {
        kind: "slot",
        relationshipTypeId: lineage.relationshipTypeId,
        sourcePageId: lineage.sourcePageId,
        activationIds: slotLineages.flatMap(
          (candidate) => activeByLineage.get(candidate.id) ?? [],
        ),
        tenant,
        context,
      });
    }
    const source = documentById.get(lineage.sourcePageId)!;
    const target = documentById.get(lineage.targetPageId)!;
    items.push({
      edgeId: lineage.id,
      lineageId: lineage.id,
      typeId: lineage.relationshipTypeId,
      typeVersionId: bundle.version.id,
      sourcePageId: lineage.sourcePageId,
      targetPageId: lineage.targetPageId,
      direction,
      state: source.trashedAt || target.trashedAt ? "suspended" : "active",
      observedActivationIds: activationIds,
      observationToken,
      slotObservationToken,
      source: {
        pageId: source.id,
        title: source.title,
        state: source.trashedAt ? "trashed" : "active",
      },
      target: {
        pageId: target.id,
        title: target.title,
        state: target.trashedAt ? "trashed" : "active",
      },
      relationship: {
        forwardLabel: bundle.version.forwardLabel,
        inverseLabel: bundle.version.inverseLabel,
        label:
          direction === "outgoing"
            ? bundle.version.forwardLabel
            : bundle.version.inverseLabel,
        forwardCardinality:
          bundle.version.forwardCardinality === "one" ? "one" : "many",
      },
      routes: entry.routes,
    });
  }
  return {
    scope: "viewer-accessible",
    items,
    nextCursor:
      offset + page.length < authorized.length
        ? encodeRelationshipCursor(offset + page.length)
        : null,
  };
}
