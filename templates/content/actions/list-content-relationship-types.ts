import { defineAction, isActionContractError } from "@agent-native/core/action";
import { and, eq, isNull } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import {
  listContentRelationshipTypesInputSchema,
  type ListContentRelationshipTypesInput,
  type ListContentRelationshipTypesResult,
} from "../shared/relationships.js";
import {
  decodeRelationshipCursor,
  encodeRelationshipCursor,
  loadRelationshipDatabase,
  loadRelationshipTypeBundle,
  relationshipCapabilities,
  relationshipProjectionDto,
  relationshipTypeDto,
  relationshipTypeVersionDto,
  type RelationshipDatabaseContext,
} from "./_relationship-core.js";

async function accessibleDatabase(
  databaseId: string,
): Promise<RelationshipDatabaseContext | null> {
  try {
    return await loadRelationshipDatabase(databaseId, "viewer");
  } catch (error) {
    if (isActionContractError(error) && error.errorCode === "NOT_ACCESSIBLE") {
      return null;
    }
    throw error;
  }
}

async function listContentRelationshipTypes(
  input: ListContentRelationshipTypesInput,
): Promise<ListContentRelationshipTypesResult> {
  const db = getDb();
  const anchor = await loadRelationshipDatabase(input.databaseId, "viewer", db);
  const typeRows = await db
    .select()
    .from(schema.contentRelationshipTypes)
    .where(
      and(
        eq(schema.contentRelationshipTypes.spaceId, anchor.database.spaceId!),
        eq(schema.contentRelationshipTypes.state, "active"),
      ),
    );
  const items: ListContentRelationshipTypesResult["items"] = [];
  for (const typeRow of typeRows) {
    const bundle = await loadRelationshipTypeBundle(typeRow.id, { db });
    if (
      bundle.version.sourceDatabaseId !== input.databaseId &&
      bundle.version.targetDatabaseId !== input.databaseId
    ) {
      continue;
    }
    const [source, target] = await Promise.all([
      accessibleDatabase(bundle.version.sourceDatabaseId),
      accessibleDatabase(bundle.version.targetDatabaseId),
    ]);
    if (!source || !target) continue;
    const projectionRows = await db
      .select()
      .from(schema.contentRelationshipProjections)
      .where(
        and(
          eq(
            schema.contentRelationshipProjections.relationshipTypeId,
            typeRow.id,
          ),
          isNull(schema.contentRelationshipProjections.archivedAt),
        ),
      );
    const projections = [];
    for (const projection of projectionRows) {
      if (await accessibleDatabase(projection.databaseId)) {
        projections.push(relationshipProjectionDto(projection));
      }
    }
    const direction =
      bundle.version.sourceDatabaseId === input.databaseId
        ? "forward"
        : "inverse";
    items.push({
      type: relationshipTypeDto(typeRow),
      version: relationshipTypeVersionDto(bundle.version),
      projections,
      capabilities: relationshipCapabilities({
        databaseRole: anchor.role,
        pageRole: anchor.role,
        direction,
        editable:
          direction === "forward" ||
          projections.some(
            (projection) =>
              projection.databaseId === input.databaseId &&
              projection.direction === "inverse" &&
              projection.editable,
          ),
        cardinality:
          bundle.version.forwardCardinality === "one" ? "one" : "many",
      }),
    });
  }
  items.sort((left, right) => left.type.id.localeCompare(right.type.id));
  const offset = decodeRelationshipCursor(input.cursor);
  const page = items.slice(offset, offset + input.limit);
  return {
    scope: "viewer-accessible",
    items: page,
    nextCursor:
      offset + page.length < items.length
        ? encodeRelationshipCursor(offset + page.length)
        : null,
  };
}

export default defineAction({
  description:
    "List supported canonical relationship types available from one readable Content database.",
  mcpTool: true,
  schema: listContentRelationshipTypesInputSchema,
  http: { method: "GET" },
  readOnly: true,
  run: listContentRelationshipTypes,
});
