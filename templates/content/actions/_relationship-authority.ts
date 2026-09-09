import type { ActionRunContext } from "@agent-native/core/action";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import type { RelationshipRouteRef } from "../shared/relationships.js";
import {
  loadRelationshipDatabase,
  relationshipError,
  requireRelationshipDocumentAccess,
  type RelationshipDb,
  type RelationshipTypeBundle,
} from "./_relationship-core.js";

export interface AuthorizedRelationshipRoute {
  route: RelationshipRouteRef;
  databaseIds: string[];
  propertyIds: string[];
  source: typeof schema.documents.$inferSelect;
  target: typeof schema.documents.$inferSelect;
}

async function assertEndpointEligibility(
  db: RelationshipDb,
  args: {
    bundle: RelationshipTypeBundle;
    source: typeof schema.documents.$inferSelect;
    target: typeof schema.documents.$inferSelect;
    admissionRequired: boolean;
  },
): Promise<void> {
  const { bundle, source, target } = args;
  if (
    source.id === target.id ||
    source.spaceId !== bundle.type.spaceId ||
    target.spaceId !== bundle.type.spaceId ||
    source.orgId !== bundle.type.orgId ||
    target.orgId !== bundle.type.orgId
  ) {
    relationshipError(
      "INVALID_TARGET",
      "Relationship endpoints must be different Pages in the relationship type's Content space and tenant.",
    );
  }
  const permanentlyDeleted = await db
    .select({ pageId: schema.contentRelationshipEndpointStates.pageId })
    .from(schema.contentRelationshipEndpointStates)
    .where(
      and(
        eq(
          schema.contentRelationshipEndpointStates.spaceId,
          bundle.type.spaceId,
        ),
        isNotNull(
          schema.contentRelationshipEndpointStates.permanentlyDeletedAt,
        ),
        inArray(schema.contentRelationshipEndpointStates.pageId, [
          source.id,
          target.id,
        ]),
      ),
    );
  if (
    permanentlyDeleted.some(
      (state) => state.pageId === source.id || state.pageId === target.id,
    )
  ) {
    relationshipError(
      "INVALID_TARGET",
      "A relationship endpoint is unavailable.",
      { statusCode: 409 },
    );
  }
  if (!args.admissionRequired) return;
  if (source.trashedAt || target.trashedAt) {
    relationshipError(
      "INVALID_TARGET",
      "Trashed Pages cannot be admitted to a relationship.",
      { statusCode: 409 },
    );
  }
  const [sourceMembership] = await db
    .select({ id: schema.contentDatabaseItems.id })
    .from(schema.contentDatabaseItems)
    .where(
      and(
        eq(
          schema.contentDatabaseItems.databaseId,
          bundle.version.sourceDatabaseId,
        ),
        eq(schema.contentDatabaseItems.documentId, source.id),
      ),
    );
  const [targetMembership] = await db
    .select({ id: schema.contentDatabaseItems.id })
    .from(schema.contentDatabaseItems)
    .where(
      and(
        eq(
          schema.contentDatabaseItems.databaseId,
          bundle.version.targetDatabaseId,
        ),
        eq(schema.contentDatabaseItems.documentId, target.id),
      ),
    );
  if (!sourceMembership || !targetMembership) {
    relationshipError(
      "INVALID_TARGET",
      "A Page is outside the relationship type's current Database selection.",
      { statusCode: 409 },
    );
  }
}

async function assertAdmissionDatabasesAvailable(
  db: RelationshipDb,
  bundle: RelationshipTypeBundle,
): Promise<void> {
  const rows = await db
    .select({
      id: schema.contentDatabases.id,
      deletedAt: schema.contentDatabases.deletedAt,
    })
    .from(schema.contentDatabases)
    .where(
      inArray(schema.contentDatabases.id, [
        bundle.version.sourceDatabaseId,
        bundle.version.targetDatabaseId,
      ]),
    );
  if (
    rows.length !==
      new Set([
        bundle.version.sourceDatabaseId,
        bundle.version.targetDatabaseId,
      ]).size ||
    rows.some((row) => row.deletedAt)
  ) {
    relationshipError(
      "CONSTRAINT_UNAVAILABLE",
      "A relationship admission database is unavailable.",
      { statusCode: 409 },
    );
  }
}

async function assertProjectionIsLocal(
  db: RelationshipDb,
  propertyId: string,
): Promise<void> {
  const [managed] = await db
    .select({ id: schema.contentDatabaseSourceFields.id })
    .from(schema.contentDatabaseSourceFields)
    .innerJoin(
      schema.contentDatabaseSources,
      eq(
        schema.contentDatabaseSources.id,
        schema.contentDatabaseSourceFields.sourceId,
      ),
    )
    .where(
      and(
        eq(schema.contentDatabaseSourceFields.propertyId, propertyId),
        eq(schema.contentDatabaseSourceFields.writeOwner, "source"),
      ),
    );
  if (managed) {
    relationshipError(
      "SOURCE_AUTHORITY_UNSUPPORTED",
      "Source-managed relationship mutation is not supported.",
      { statusCode: 409 },
    );
  }
}

export async function authorizeRelationshipRoute(args: {
  db?: RelationshipDb;
  bundle: RelationshipTypeBundle;
  sourcePageId: string;
  targetPageId: string;
  route: RelationshipRouteRef;
  operation: "add" | "remove" | "replace" | "undo";
  context?: ActionRunContext;
}): Promise<AuthorizedRelationshipRoute> {
  const db = args.db ?? getDb();
  const sourceAccess = await requireRelationshipDocumentAccess(
    args.sourcePageId,
    args.route.kind === "inverse-property" ? "viewer" : "editor",
    { db, context: args.context },
  );
  const targetAccess = await requireRelationshipDocumentAccess(
    args.targetPageId,
    args.route.kind === "inverse-property" ? "editor" : "viewer",
    { db, context: args.context },
  );
  const source = sourceAccess.resource;
  const target = targetAccess.resource;
  await assertEndpointEligibility(db, {
    bundle: args.bundle,
    source,
    target,
    admissionRequired: args.operation === "add" || args.operation === "replace",
  });
  if (args.operation === "add" || args.operation === "replace") {
    await assertAdmissionDatabasesAvailable(db, args.bundle);
  }

  if (args.route.kind === "connections-forward") {
    if (args.route.sourcePageId !== source.id) {
      relationshipError(
        "ROUTE_NOT_AUTHORIZED",
        "The Connections route does not match the relationship source Page.",
        { statusCode: 403 },
      );
    }
    const sourceDatabase = await loadRelationshipDatabase(
      args.bundle.version.sourceDatabaseId,
      "viewer",
      db,
      args.context,
      {
        allowDeleted: args.operation === "remove" || args.operation === "undo",
      },
    );
    return {
      route: args.route,
      databaseIds: [sourceDatabase.database.id],
      propertyIds: [],
      source,
      target,
    };
  }

  const propertyId = args.route.propertyId;
  const [projection] = await db
    .select()
    .from(schema.contentRelationshipProjections)
    .where(
      and(
        eq(schema.contentRelationshipProjections.propertyId, propertyId),
        eq(
          schema.contentRelationshipProjections.relationshipTypeId,
          args.bundle.type.id,
        ),
        isNull(schema.contentRelationshipProjections.archivedAt),
      ),
    );
  if (!projection) {
    relationshipError(
      "ROUTE_NOT_AUTHORIZED",
      "The relation Property route is unavailable.",
      { statusCode: 403 },
    );
  }
  await assertProjectionIsLocal(db, propertyId);
  if (args.route.kind === "forward-property") {
    if (
      projection.direction !== "forward" ||
      projection.databaseId !== args.bundle.version.sourceDatabaseId ||
      args.route.sourcePageId !== source.id
    ) {
      relationshipError(
        "ROUTE_NOT_AUTHORIZED",
        "The forward relation Property route does not match this edge.",
        { statusCode: 403 },
      );
    }
    await loadRelationshipDatabase(
      projection.databaseId,
      "editor",
      db,
      args.context,
    );
  } else {
    if (
      projection.direction !== "inverse" ||
      projection.databaseId !== args.bundle.version.targetDatabaseId ||
      projection.editable !== 1 ||
      args.route.targetPageId !== target.id
    ) {
      relationshipError(
        "ROUTE_NOT_AUTHORIZED",
        "The inverse relation Property is not an editable route for this edge.",
        { statusCode: 403 },
      );
    }
    await loadRelationshipDatabase(
      projection.databaseId,
      "editor",
      db,
      args.context,
    );
  }
  return {
    route: args.route,
    databaseIds: [projection.databaseId],
    propertyIds: [projection.propertyId],
    source,
    target,
  };
}
