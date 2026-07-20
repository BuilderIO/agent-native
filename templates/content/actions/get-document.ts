import { defineAction } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { parseDocumentHideFromSearch } from "../server/lib/documents.js";
import { favoriteDocumentIds } from "./_content-favorites.js";
import { resolveContentSpaceAccess } from "./_content-space-access.js";
import {
  getDatabaseByDocumentId,
  getDocumentContextPath,
  getDatabaseItemByDocumentId,
  isSoftDeletedDatabaseDocument,
  serializeDatabaseMembership,
} from "./_database-utils.js";
import { serializeDocumentSource } from "./_document-source.js";
import {
  listPropertiesForDocument,
  serializeDatabase,
} from "./_property-utils.js";

function canEditRole(role: string) {
  return role === "owner" || role === "admin" || role === "editor";
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
  description: "Get a single document by ID with full content.",
  schema: z.object({
    id: z.string().optional().describe("Document ID (required)"),
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
    if (await isSoftDeletedDatabaseDocument(args.id)) {
      throw Object.assign(new Error(`Document "${args.id}" not found`), {
        statusCode: 404,
      });
    }
    const doc = access.resource;
    const database = await getDatabaseByDocumentId(doc.id);
    const databaseMembership = await getDatabaseItemByDocumentId(doc.id);
    const userEmail = getRequestUserEmail();
    const favoriteIds = userEmail
      ? await favoriteDocumentIds(getDb(), userEmail, [doc.id])
      : new Set<string>();

    return {
      id: doc.id,
      deepLink: buildDeepLink({
        app: "content",
        view: "editor",
        params: { documentId: doc.id },
      }),
      parentId: doc.parentId,
      title: doc.title,
      content: doc.content,
      description: doc.description,
      icon: doc.icon,
      position: doc.position,
      isFavorite: favoriteIds.has(doc.id),
      hideFromSearch: parseDocumentHideFromSearch(doc.hideFromSearch),
      visibility: doc.visibility,
      source: serializeDocumentSource(doc),
      accessRole: access.role,
      canEdit: canEditRole(access.role),
      canManage: canManageRole(access.role),
      database: database
        ? serializeDatabase(database, doc.description)
        : undefined,
      databaseMembership: databaseMembership
        ? serializeDatabaseMembership(databaseMembership)
        : undefined,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      properties: await listPropertiesForDocument(doc),
      contextPath: await getDocumentContextPath(doc),
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
