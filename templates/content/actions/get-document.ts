import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess, roleSatisfies } from "@agent-native/core/sharing";
import { track } from "@agent-native/core/tracking";
import { and, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { parseDocumentHideFromSearch } from "../server/lib/documents.js";
import { favoriteDocumentIds } from "./_content-favorites.js";
import {
  getDatabaseByDocumentId,
  getBuilderBodyHydrationMembershipByDocumentId,
  getDocumentContextPath,
  isSoftDeletedDatabaseDocument,
  listDatabaseItemsByDocumentId,
  serializeDatabaseMembership,
} from "./_database-utils.js";
import {
  accessibleDocumentIds,
  resolveDocumentAccess,
} from "./_document-access.js";
import {
  documentContentHash,
  documentRevisionToken,
} from "./_document-edit-mutation.js";
import { serializeDocumentSource } from "./_document-source.js";
import {
  getDatabaseById,
  listPropertiesForDocument,
  resolvePropertyDatabaseForDocument,
  serializeDatabase,
} from "./_property-utils.js";
import {
  canSuggestDocument,
  documentHasInlineDatabase,
  hasSuggestionBodyTarget,
} from "./_suggestion-eligibility.js";

function canEditRole(role: string) {
  return role === "owner" || role === "admin" || role === "editor";
}

function canCommentRole(role: string) {
  return roleSatisfies(
    role as Parameters<typeof roleSatisfies>[0],
    "commenter",
  );
}

function canManageRole(role: string) {
  return role === "owner" || role === "admin";
}

/**
 * Starts a read now but raises its failure only where the result is awaited,
 * so a read whose result a later check discards cannot fail the request.
 */
function deferFailure<T>(read: Promise<T>): () => Promise<T> {
  const settled = read.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  return async () => {
    const result = await settled;
    if (!result.ok) throw result.error;
    return result.value;
  };
}

export default defineAction({
  description:
    "Read one access-scoped document by its stable ID, including the full Markdown body and metadata. Use list-documents or search-documents first when the ID is unknown.",
  deferLoading: false,
  mcpTool: true,
  schema: z.object({
    id: z
      .string()
      .optional()
      .describe("Stable document ID returned by a Content discovery action."),
    databaseId: z
      .string()
      .optional()
      .describe(
        "Exact collection ID when reading membership-local properties for a collection item.",
      ),
    databaseDocumentId: z
      .string()
      .optional()
      .describe(
        "Backing collection document ID; only use with databaseId for the exact collection context.",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async (args, ctx) => {
    if (!args.id) throw new Error("--id is required");

    const access = await resolveDocumentAccess(args.id);
    if (!access || access.resource.trashedAt) {
      throw Object.assign(new Error(`Document "${args.id}" not found`), {
        statusCode: 404,
      });
    }
    const doc = access.resource;
    const db = getDb();
    const userEmail = getRequestUserEmail();
    const source = serializeDocumentSource(doc);
    const hasInlineDatabase = documentHasInlineDatabase(doc.content ?? "");
    const mayBeExternallyLinked =
      canCommentRole(access.role) && !source?.mode && !hasInlineDatabase;

    // These reads depend only on the document, so they run as one round of
    // parallel statements. The checks after them decide what is returned.
    const [
      softDeleted,
      memberships,
      database,
      databaseItems,
      bodyHydrationTarget,
      favoriteIds,
      externalLink,
    ] = await Promise.all([
      isSoftDeletedDatabaseDocument(args.id),
      db
        .select({
          databaseId: schema.contentDatabases.id,
          databaseDocumentId: schema.contentDatabases.documentId,
          systemRole: schema.contentDatabases.systemRole,
          primaryId: schema.documentPropertyDefinitions.id,
        })
        .from(schema.contentDatabaseItems)
        .innerJoin(
          schema.contentDatabases,
          eq(
            schema.contentDatabases.id,
            schema.contentDatabaseItems.databaseId,
          ),
        )
        .leftJoin(
          schema.documentPropertyDefinitions,
          and(
            eq(
              schema.documentPropertyDefinitions.id,
              schema.contentDatabases.primaryBlocksPropertyId,
            ),
            eq(
              schema.documentPropertyDefinitions.databaseId,
              schema.contentDatabases.id,
            ),
            eq(schema.documentPropertyDefinitions.type, "blocks"),
          ),
        )
        .where(
          and(
            eq(schema.contentDatabaseItems.documentId, doc.id),
            isNull(schema.contentDatabases.deletedAt),
          ),
        )
        .orderBy(schema.contentDatabases.id),
      getDatabaseByDocumentId(doc.id),
      listDatabaseItemsByDocumentId(doc.id),
      getBuilderBodyHydrationMembershipByDocumentId(doc.id),
      userEmail
        ? favoriteDocumentIds(db, userEmail, [doc.id])
        : new Set<string>(),
      mayBeExternallyLinked
        ? db
            .select({ documentId: schema.documentSyncLinks.documentId })
            .from(schema.documentSyncLinks)
            .where(
              and(
                eq(schema.documentSyncLinks.documentId, doc.id),
                ne(schema.documentSyncLinks.state, "unlinked"),
              ),
            )
            .limit(1)
        : [],
    ]);
    if (softDeleted) {
      throw Object.assign(new Error(`Document "${args.id}" not found`), {
        statusCode: 404,
      });
    }
    if (args.databaseDocumentId && !args.databaseId) {
      throw Object.assign(new Error("databaseDocumentId requires databaseId"), {
        statusCode: 404,
      });
    }

    const ordinaryMemberships = memberships.filter(
      (membership) => membership.systemRole === null,
    );
    const bodyHydrationMembership = bodyHydrationTarget?.membership;
    const readBodyHydrationAccess = deferFailure(
      bodyHydrationTarget?.hydrationSourceId
        ? resolveDocumentAccess(bodyHydrationMembership!.database.documentId, {
            skipResourceBody: true,
          })
        : Promise.resolve(null),
    );
    const accessibleDatabases = await accessibleDocumentIds(
      memberships.map((membership) => membership.databaseDocumentId),
    );
    accessibleDatabases.add(doc.id);
    const accessiblePrimaryMemberships = memberships.filter(
      (membership) =>
        membership.primaryId &&
        (membership.systemRole === null
          ? accessibleDatabases.has(membership.databaseDocumentId)
          : ordinaryMemberships.length === 0 &&
            membership.systemRole === "files"),
    );
    const selectedDatabaseId =
      args.databaseId ?? accessiblePrimaryMemberships[0]?.databaseId;
    const databaseMembership =
      (selectedDatabaseId
        ? databaseItems.find(
            (row) => row.item.databaseId === selectedDatabaseId,
          )
        : databaseItems[0]) ?? null;
    const propertyDatabase = selectedDatabaseId
      ? (databaseMembership?.database ??
        (database?.id === selectedDatabaseId
          ? database
          : await getDatabaseById(selectedDatabaseId)))
      : await resolvePropertyDatabaseForDocument(doc);
    const hasPropertyDatabaseAccess = Boolean(
      propertyDatabase && accessibleDatabases.has(propertyDatabase.documentId),
    );
    if (
      args.databaseId &&
      (!propertyDatabase ||
        (!hasPropertyDatabaseAccess && access.role === "owner") ||
        (propertyDatabase.documentId !== doc.id && !databaseMembership))
    ) {
      throw Object.assign(new Error("Database context not found"), {
        statusCode: 404,
      });
    }
    if (
      args.databaseDocumentId &&
      propertyDatabase?.documentId !== args.databaseDocumentId
    ) {
      throw Object.assign(new Error("Database context not found"), {
        statusCode: 404,
      });
    }
    if (selectedDatabaseId && !propertyDatabase) {
      throw new Error(`Database "${selectedDatabaseId}" not found`);
    }
    const bodyHydrationAccess = await readBodyHydrationAccess();
    const bodyHydration = bodyHydrationMembership
      ? serializeDatabaseMembership(bodyHydrationMembership).bodyHydration
      : null;
    // A page that only a share opens gets no collection path, so the path is
    // read only when it will be returned, and its errors surface after the
    // property checks that preceded it.
    const readContextPath =
      databaseMembership && !hasPropertyDatabaseAccess
        ? null
        : deferFailure(
            getDocumentContextPath(doc, { databaseId: args.databaseId }),
          );
    const [properties] = await Promise.all([
      listPropertiesForDocument(doc, selectedDatabaseId, {
        // A share authorizes the exact page and its membership-local fields,
        // not the private database document that owns those definitions.
        requireDatabaseAccess: hasPropertyDatabaseAccess,
        database: propertyDatabase,
      }),
      // Reading the collection's own fields also takes resolveAccess on its
      // document, which can refuse a document accessibleDocumentIds admits.
      selectedDatabaseId && hasPropertyDatabaseAccess
        ? assertAccess(
            "document",
            propertyDatabase!.documentId,
            "viewer",
            undefined,
            { skipResourceBody: true },
          )
        : undefined,
    ]);
    const contextPath = readContextPath ? await readContextPath() : [];
    let isExternallyLinked = false;
    let hasBodyTarget = true;
    if (mayBeExternallyLinked && !database) {
      isExternallyLinked = externalLink.length > 0;
      hasBodyTarget = hasSuggestionBodyTarget({
        hasDatabaseMembership: memberships.length > 0,
        hasPrimaryBlocksField: args.databaseId
          ? accessiblePrimaryMemberships.some(
              (item) => item.databaseId === args.databaseId,
            )
          : accessiblePrimaryMemberships.length > 0,
      });
    }
    const canSuggest = canSuggestDocument({
      canComment: canCommentRole(access.role),
      isDatabase: Boolean(database),
      hasBodyTarget,
      isExternallyLinked,
      isSourceOwned: Boolean(
        doc.sourceMode || doc.sourceKind || doc.sourcePath,
      ),
      hasInlineDatabase,
    });
    const revision = documentRevisionToken(doc.bodyRevision, doc.content ?? "");

    track(
      "document_viewed",
      {
        app_name: "content",
        template_name: "content",
        output_id: doc.id,
        output_type: "document",
        is_owner: access.role === "owner",
      },
      ctx,
    );

    return {
      id: doc.id,
      spaceId: doc.spaceId,
      deepLink: buildDeepLink({
        app: "content",
        view: "editor",
        params: { documentId: doc.id },
      }),
      parentId:
        databaseMembership && !hasPropertyDatabaseAccess ? null : doc.parentId,
      title: doc.title,
      content: doc.content,
      revision,
      baseRevision: revision,
      bodyRevision: doc.bodyRevision,
      collabContentRevision:
        doc.collabBodyRevision === doc.bodyRevision ? revision : null,
      contentHash: documentContentHash(doc.content ?? ""),
      description: doc.description,
      icon: doc.icon,
      position: doc.position,
      isFavorite: favoriteIds.has(doc.id),
      hideFromSearch: parseDocumentHideFromSearch(doc.hideFromSearch),
      visibility: doc.visibility,
      source,
      accessRole: access.role,
      canComment: canCommentRole(access.role),
      canSuggest,
      canEdit: canEditRole(access.role),
      canManage: canManageRole(access.role),
      database: database
        ? serializeDatabase(database, doc.description)
        : undefined,
      databaseMembership: databaseMembership
        ? hasPropertyDatabaseAccess
          ? serializeDatabaseMembership(databaseMembership)
          : {
              databaseId: null,
              databaseDocumentId: null,
              databaseTitle: null,
              position: null,
            }
        : undefined,
      bodyHydration: bodyHydrationMembership
        ? {
            hydration: bodyHydrationAccess
              ? bodyHydration!
              : {
                  status: bodyHydration!.status,
                  attemptedAt: null,
                  error: null,
                  version: null,
                },
            ...(bodyHydrationAccess &&
            canEditRole(bodyHydrationAccess.role) &&
            bodyHydrationTarget?.hydrationSourceId
              ? {
                  provider: "builder" as const,
                  sourceId: bodyHydrationTarget.hydrationSourceId,
                  databaseDocumentId:
                    bodyHydrationMembership.database.documentId,
                }
              : {}),
          }
        : undefined,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      properties: hasPropertyDatabaseAccess
        ? properties
        : properties.map((property) => ({
            ...property,
            definition: { ...property.definition, databaseId: null },
          })),
      contextPath,
    };
  },
  link: ({ result }) => {
    const id = (result as { id?: string } | null)?.id;
    if (!id) return null;
    return {
      url: buildDeepLink({
        app: "content",
        view: "editor",
        params: { documentId: id },
      }),
      label: "Open document",
      view: "editor",
    };
  },
});
