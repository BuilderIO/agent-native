import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  notExists,
  or,
  sql,
} from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import {
  listContentRelationCandidatesInputSchema,
  type ContentRelationCandidate,
  type ListContentRelationCandidatesInput,
  type ListContentRelationCandidatesResult,
} from "../shared/relationships.js";
import { resolveContentDocumentAccess } from "./_content-document-access.js";
import { listContentOrganizationMemberships } from "./_content-space-access.js";
import {
  activeActivationIdsForLineages,
  decodeRelationshipCursor,
  encodeRelationshipCursor,
  loadRelationshipDatabase,
  loadRelationshipTypeBundle,
  relationshipActorContext,
  relationshipError,
} from "./_relationship-core.js";
import { issueRelationshipObservation } from "./_relationship-read.js";

function escapeLike(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1");
}

async function slotObservation(
  args: {
    relationshipTypeId: string;
    sourcePageId: string;
    ownerEmail: string;
    orgId: string | null;
    spaceId: string;
  },
  context?: ActionRunContext,
): Promise<string> {
  const db = getDb();
  const lineages = await db
    .select({ id: schema.contentRelationshipLineages.id })
    .from(schema.contentRelationshipLineages)
    .where(
      and(
        eq(
          schema.contentRelationshipLineages.relationshipTypeId,
          args.relationshipTypeId,
        ),
        eq(schema.contentRelationshipLineages.sourcePageId, args.sourcePageId),
      ),
    );
  const active = await activeActivationIdsForLineages(
    db,
    lineages.map((lineage) => lineage.id),
  );
  return issueRelationshipObservation(db, {
    kind: "slot",
    relationshipTypeId: args.relationshipTypeId,
    sourcePageId: args.sourcePageId,
    activationIds: lineages.flatMap((lineage) => active.get(lineage.id) ?? []),
    tenant: {
      ownerEmail: args.ownerEmail,
      orgId: args.orgId,
      spaceId: args.spaceId,
    },
    context,
  });
}

async function listContentRelationCandidates(
  input: ListContentRelationCandidatesInput,
  context?: ActionRunContext,
): Promise<ListContentRelationCandidatesResult> {
  const db = getDb();
  const [projection] = await db
    .select()
    .from(schema.contentRelationshipProjections)
    .where(
      and(
        eq(schema.contentRelationshipProjections.propertyId, input.propertyId),
        isNull(schema.contentRelationshipProjections.archivedAt),
      ),
    );
  if (!projection) {
    relationshipError(
      "NOT_ACCESSIBLE",
      "The requested relation Property is not accessible.",
      { statusCode: 404 },
    );
  }
  const ownerDatabase = await loadRelationshipDatabase(
    projection.databaseId,
    "viewer",
    db,
  );
  const anchorAccess = await resolveContentDocumentAccess(input.anchorPageId);
  if (!anchorAccess) {
    relationshipError(
      "NOT_ACCESSIBLE",
      "The requested Content Page is not accessible.",
      { statusCode: 404 },
    );
  }
  const bundle = await loadRelationshipTypeBundle(
    projection.relationshipTypeId,
    {
      db,
    },
  );
  const anchorDatabaseId =
    projection.direction === "forward"
      ? bundle.version.sourceDatabaseId
      : bundle.version.targetDatabaseId;
  if (ownerDatabase.database.id !== anchorDatabaseId) {
    relationshipError(
      "UNSUPPORTED_CONFIGURATION",
      "The relation Property does not match its canonical definition.",
    );
  }
  const [anchorMembership] = await db
    .select({ id: schema.contentDatabaseItems.id })
    .from(schema.contentDatabaseItems)
    .where(
      and(
        eq(schema.contentDatabaseItems.databaseId, anchorDatabaseId),
        eq(schema.contentDatabaseItems.documentId, input.anchorPageId),
      ),
    );
  if (!anchorMembership) {
    relationshipError(
      "INVALID_TARGET",
      "The anchor Page is outside the relation Property's database.",
      { statusCode: 409 },
    );
  }
  const candidateDatabaseId =
    projection.direction === "forward"
      ? bundle.version.targetDatabaseId
      : bundle.version.sourceDatabaseId;
  await loadRelationshipDatabase(candidateDatabaseId, "viewer", db);
  const actor = relationshipActorContext(context);
  const organizationMemberships = await listContentOrganizationMemberships(
    actor.userEmail,
  );
  const accessContexts = [
    actor.orgId,
    ...organizationMemberships.map((m) => m.orgId),
  ]
    .filter((orgId, index, values) => values.indexOf(orgId) === index)
    .map((orgId) => ({
      userEmail: actor.userEmail,
      ...(orgId ? { orgId } : {}),
    }));
  const permanentlyDeletedEndpoint = db
    .select({ pageId: schema.contentRelationshipEndpointStates.pageId })
    .from(schema.contentRelationshipEndpointStates)
    .where(
      and(
        eq(
          schema.contentRelationshipEndpointStates.pageId,
          schema.documents.id,
        ),
        isNotNull(
          schema.contentRelationshipEndpointStates.permanentlyDeletedAt,
        ),
      ),
    );
  const searchPattern = input.search ? `%${escapeLike(input.search)}%` : null;
  const offset = decodeRelationshipCursor(input.cursor);
  const documents = await db
    .select({
      id: schema.documents.id,
      title: schema.documents.title,
    })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.documents,
      eq(schema.documents.id, schema.contentDatabaseItems.documentId),
    )
    .where(
      and(
        eq(schema.contentDatabaseItems.databaseId, candidateDatabaseId),
        sql`${schema.documents.id} <> ${input.anchorPageId}`,
        isNull(schema.documents.trashedAt),
        notExists(permanentlyDeletedEndpoint),
        or(
          ...accessContexts.map((accessContext) =>
            accessFilter(
              schema.documents,
              schema.documentShares,
              accessContext,
              "viewer",
              { includePublic: true },
            ),
          ),
        ),
        searchPattern
          ? sql`lower(${schema.documents.title}) LIKE lower(${searchPattern}) ESCAPE '\\'`
          : undefined,
      ),
    )
    .orderBy(
      asc(sql`lower(${schema.documents.title})`),
      asc(schema.documents.title),
      asc(schema.documents.id),
    )
    .limit(input.limit + 1)
    .offset(offset);
  const contextDefinitions = input.contextPropertyIds.length
    ? await db
        .select({
          id: schema.documentPropertyDefinitions.id,
          type: schema.documentPropertyDefinitions.type,
        })
        .from(schema.documentPropertyDefinitions)
        .where(
          and(
            inArray(
              schema.documentPropertyDefinitions.id,
              input.contextPropertyIds,
            ),
            eq(
              schema.documentPropertyDefinitions.databaseId,
              candidateDatabaseId,
            ),
          ),
        )
    : [];
  if (contextDefinitions.length !== new Set(input.contextPropertyIds).size) {
    relationshipError(
      "INVALID_TARGET",
      "A requested context Property is not part of the candidate database.",
    );
  }
  if (contextDefinitions.some((definition) => definition.type === "relation")) {
    relationshipError(
      "UNSUPPORTED_CONFIGURATION",
      "Relation Properties cannot be returned as raw candidate context. Request ordinary context Properties instead.",
    );
  }
  const page = documents.slice(0, input.limit);
  const valueRows =
    page.length && contextDefinitions.length
      ? await db
          .select({
            documentId: schema.documentPropertyValues.documentId,
            propertyId: schema.documentPropertyValues.propertyId,
            valueJson: schema.documentPropertyValues.valueJson,
          })
          .from(schema.documentPropertyValues)
          .where(
            and(
              inArray(
                schema.documentPropertyValues.documentId,
                page.map((document) => document.id),
              ),
              inArray(
                schema.documentPropertyValues.propertyId,
                contextDefinitions.map((definition) => definition.id),
              ),
            ),
          )
      : [];
  const contextByPage = new Map<string, Record<string, unknown>>();
  for (const row of valueRows) {
    let value: unknown;
    try {
      value = JSON.parse(row.valueJson);
    } catch {
      relationshipError(
        "UNAVAILABLE",
        "A requested candidate context value is unreadable.",
        { statusCode: 503 },
      );
    }
    const values = contextByPage.get(row.documentId) ?? {};
    values[row.propertyId] = value;
    contextByPage.set(row.documentId, values);
  }
  const items: ContentRelationCandidate[] = [];
  for (const document of page) {
    items.push({
      pageId: document.id,
      title: document.title,
      context: contextByPage.get(document.id) ?? {},
      slotObservationToken:
        projection.direction === "inverse" &&
        bundle.version.forwardCardinality === "one"
          ? await slotObservation(
              {
                relationshipTypeId: bundle.type.id,
                sourcePageId: document.id,
                ownerEmail: bundle.type.ownerEmail,
                orgId: bundle.type.orgId,
                spaceId: bundle.type.spaceId,
              },
              context,
            )
          : null,
    });
  }
  return {
    scope: "viewer-accessible",
    items,
    slotObservationToken:
      projection.direction === "forward" &&
      bundle.version.forwardCardinality === "one"
        ? await slotObservation(
            {
              relationshipTypeId: bundle.type.id,
              sourcePageId: input.anchorPageId,
              ownerEmail: bundle.type.ownerEmail,
              orgId: bundle.type.orgId,
              spaceId: bundle.type.spaceId,
            },
            context,
          )
        : null,
    nextCursor:
      documents.length > input.limit
        ? encodeRelationshipCursor(offset + page.length)
        : null,
  };
}

export default defineAction({
  description:
    "Search caller-accessible Page candidates for one canonical relation Property, including bounded typed context.",
  mcpTool: true,
  schema: listContentRelationCandidatesInputSchema,
  http: { method: "GET" },
  readOnly: true,
  run: listContentRelationCandidates,
});
