import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { resolveAccess, roleSatisfies } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { parseDocumentHideFromSearch } from "../server/lib/documents.js";
import { favoriteDocumentIds } from "./_content-favorites.js";
import { resolveContentSpaceAccess } from "./_content-space-access.js";
import {
  getDatabaseByDocumentId,
  getBuilderBodyHydrationMembershipByDocumentId,
  getDocumentContextPath,
  getDatabaseItemByDocumentId,
  isSoftDeletedDatabaseDocument,
  serializeDatabaseMembership,
} from "./_database-utils.js";
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

async function resolveDocumentAccess(id: string) {
  const current = await resolveAccess("document", id);
  if (current) return current;
  const [reference] = await getDb()
    .select({ spaceId: schema.documents.spaceId })
    .from(schema.documents)
    .where(eq(schema.documents.id, id))
    .limit(1);
  if (!reference?.spaceId) return null;
  try {
    const spaceAccess = await resolveContentSpaceAccess(reference.spaceId);
    return resolveAccess("document", id, {
      userEmail: spaceAccess.authority.userEmail,
      orgId: spaceAccess.authority.orgId ?? undefined,
    });
  } catch {
    return null;
  }
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
  run: async (args) => {
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
      revision: documentRevisionToken(doc.bodyRevision, doc.content ?? ""),
      baseRevision: documentRevisionToken(doc.bodyRevision, doc.content ?? ""),
      bodyRevision: doc.bodyRevision,
      contentHash: documentContentHash(doc.content ?? ""),
      description: doc.description,
      icon: doc.icon,
      position: doc.position,
      isFavorite: favoriteIds.has(doc.id),
      hideFromSearch: parseDocumentHideFromSearch(doc.hideFromSearch),
      visibility: doc.visibility,
      source: serializeDocumentSource(doc),
      accessRole: access.role,
      canComment: canCommentRole(access.role),
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
