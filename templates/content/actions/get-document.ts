import { defineAction } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  parseDocumentFavorite,
  parseDocumentHideFromSearch,
} from "../server/lib/documents.js";
import {
  getDatabaseByDocumentId,
  getDatabaseItemByDocumentId,
  isSoftDeletedDatabaseDocument,
  serializeDatabaseMembership,
} from "./_database-utils.js";
import { serializeDocumentSource } from "./_document-source.js";
import {
  getLocalFileDocument,
  isLocalDocumentId,
  isContentLocalFileMode,
} from "./_local-file-documents.js";
import "../server/db/index.js";
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

    if ((await isContentLocalFileMode()) && isLocalDocumentId(args.id)) {
      return getLocalFileDocument(args.id);
    }

    const access = await resolveAccess("document", args.id);
    if (!access) throw new Error(`Document "${args.id}" not found`);
    if (await isSoftDeletedDatabaseDocument(args.id)) {
      throw new Error(`Document "${args.id}" not found`);
    }
    const doc = access.resource;
    const database = await getDatabaseByDocumentId(doc.id);
    const databaseMembership = await getDatabaseItemByDocumentId(doc.id);

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
      icon: doc.icon,
      position: doc.position,
      isFavorite: parseDocumentFavorite(doc.isFavorite),
      hideFromSearch: parseDocumentHideFromSearch(doc.hideFromSearch),
      visibility: doc.visibility,
      source: serializeDocumentSource(doc),
      accessRole: access.role,
      canEdit: canEditRole(access.role),
      canManage: canManageRole(access.role),
      database: database ? serializeDatabase(database) : undefined,
      databaseMembership: databaseMembership
        ? serializeDatabaseMembership(databaseMembership)
        : undefined,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      properties: await listPropertiesForDocument(doc),
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
