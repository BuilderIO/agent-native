import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { roleSatisfies } from "@agent-native/core/sharing";
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
  getDatabaseItemByDocumentId,
  isSoftDeletedDatabaseDocument,
  serializeDatabaseMembership,
} from "./_database-utils.js";
import { resolveDocumentAccess } from "./_document-access.js";
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
        "Exact database ID when reading membership-local properties for a database item.",
      ),
    databaseDocumentId: z
      .string()
      .optional()
      .describe(
        "Backing database document ID; only use with databaseId for the exact database context.",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async (args, ctx) => {
    if (!args.id) throw new Error("--id is required");

    const access = await resolveDocumentAccess(args.id);
    // Not-found is a deterministic client-state condition (deleted or
    // inaccessible document still referenced by an open tab) — 404, not a
    // 500 that floods the console as Internal Server Error.
    if (!access) {
      throw Object.assign(new Error(`Document "${args.id}" not found`), {
        statusCode: 404,
      });
    }
    if (
      access.resource.trashedAt ||
      (await isSoftDeletedDatabaseDocument(args.id))
    ) {
      throw Object.assign(new Error(`Document "${args.id}" not found`), {
        statusCode: 404,
      });
    }
    const doc = access.resource;
    if (args.databaseDocumentId && !args.databaseId) {
      throw Object.assign(new Error("databaseDocumentId requires databaseId"), {
        statusCode: 404,
      });
    }

    const database = await getDatabaseByDocumentId(doc.id);
    const databaseMembership = args.databaseId
      ? await getDatabaseItemByDocumentId(doc.id, {
          databaseId: args.databaseId,
        })
      : await getDatabaseItemByDocumentId(doc.id);
    const propertyDatabase = args.databaseId
      ? await getDatabaseById(args.databaseId)
      : await resolvePropertyDatabaseForDocument(doc);
    const propertyDatabaseAccess = propertyDatabase
      ? await resolveDocumentAccess(propertyDatabase.documentId)
      : null;
    if (
      args.databaseId &&
      (!propertyDatabase ||
        (!propertyDatabaseAccess && access.role === "owner") ||
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
    const bodyHydrationTarget =
      await getBuilderBodyHydrationMembershipByDocumentId(doc.id);
    const bodyHydrationMembership = bodyHydrationTarget?.membership;
    const bodyHydrationAccess = bodyHydrationTarget?.hydrationSourceId
      ? await resolveDocumentAccess(
          bodyHydrationMembership!.database.documentId,
        )
      : null;
    const bodyHydration = bodyHydrationMembership
      ? serializeDatabaseMembership(bodyHydrationMembership).bodyHydration
      : null;
    const userEmail = getRequestUserEmail();
    const favoriteIds = userEmail
      ? await favoriteDocumentIds(getDb(), userEmail, [doc.id])
      : new Set<string>();
    const properties = await listPropertiesForDocument(doc, args.databaseId, {
      // A share authorizes the exact page and its membership-local fields,
      // not the private database document that owns those definitions.
      requireDatabaseAccess: propertyDatabaseAccess !== null,
    });
    const source = serializeDocumentSource(doc);
    const hasInlineDatabase = documentHasInlineDatabase(doc.content ?? "");
    let isOrdinaryDatabaseItem = false;
    let isExternallyLinked = false;
    if (
      canCommentRole(access.role) &&
      !database &&
      !source?.mode &&
      !hasInlineDatabase
    ) {
      const db = getDb();
      const [ordinaryMembership, externalLink] = await Promise.all([
        db
          .select({ id: schema.contentDatabaseItems.id })
          .from(schema.contentDatabaseItems)
          .innerJoin(
            schema.contentDatabases,
            eq(
              schema.contentDatabases.id,
              schema.contentDatabaseItems.databaseId,
            ),
          )
          .where(
            and(
              eq(schema.contentDatabaseItems.documentId, doc.id),
              isNull(schema.contentDatabases.deletedAt),
              isNull(schema.contentDatabases.systemRole),
            ),
          )
          .limit(1),
        db
          .select({ documentId: schema.documentSyncLinks.documentId })
          .from(schema.documentSyncLinks)
          .where(
            and(
              eq(schema.documentSyncLinks.documentId, doc.id),
              ne(schema.documentSyncLinks.state, "unlinked"),
            ),
          )
          .limit(1),
      ]);
      isOrdinaryDatabaseItem = ordinaryMembership.length > 0;
      isExternallyLinked = externalLink.length > 0;
    }
    const canSuggest = canSuggestDocument({
      canComment: canCommentRole(access.role),
      isDatabase: Boolean(database),
      isOrdinaryDatabaseItem,
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
      deepLink: buildDeepLink({
        app: "content",
        view: "editor",
        params: { documentId: doc.id },
      }),
      parentId:
        databaseMembership && !propertyDatabaseAccess ? null : doc.parentId,
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
        ? propertyDatabaseAccess
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
      properties: propertyDatabaseAccess
        ? properties
        : properties.map((property) => ({
            ...property,
            definition: { ...property.definition, databaseId: null },
          })),
      contextPath:
        databaseMembership && !propertyDatabaseAccess
          ? []
          : await getDocumentContextPath(doc, {
              databaseId: args.databaseId,
            }),
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
