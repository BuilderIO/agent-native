import { defineAction, embedApp } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { buildDeepLink } from "@agent-native/core/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  parseDocumentFavorite,
  parseDocumentHideFromSearch,
} from "../server/lib/documents.js";
import { serializeDocumentSource } from "./_document-source.js";
import {
  getLocalFileDocument,
  isLocalFileDocumentId,
  localDocumentPathFromId,
} from "./_local-file-documents.js";

function nanoid(size = 12): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  for (const byte of bytes) id += chars[byte % chars.length];
  return id;
}

function serializeDocument(row: typeof schema.documents.$inferSelect) {
  return {
    id: row.id,
    urlPath: `/page/${row.id}`,
    deepLink: buildDeepLink({
      app: "content",
      view: "editor",
      params: { documentId: row.id },
    }),
    parentId: row.parentId,
    title: row.title,
    content: row.content,
    icon: row.icon,
    position: row.position,
    isFavorite: parseDocumentFavorite(row.isFavorite),
    hideFromSearch: parseDocumentHideFromSearch(row.hideFromSearch),
    visibility: row.visibility,
    accessRole: "owner" as const,
    canEdit: true,
    canManage: true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    source: serializeDocumentSource(row),
  };
}

export default defineAction({
  description:
    "Create or refresh a database-backed shareable copy of a local-file document. Use this before sharing a local file with other users.",
  schema: z.object({
    id: z.string().describe("Local file document ID to make shareable"),
  }),
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Share document",
      description:
        "Open the shareable database copy in the real Content editor so the user can invite people or change visibility.",
      iframeTitle: "Agent-Native Content",
      openLabel: "Open in Content",
      height: 900,
    }),
  },
  run: async ({ id }) => {
    if (!isLocalFileDocumentId(id)) {
      throw new Error("Only local file documents can be upgraded for sharing.");
    }

    const userEmail = getRequestUserEmail();
    if (!userEmail) throw new Error("Not authenticated");

    const localDocument = await getLocalFileDocument(id);
    const sourcePath = localDocumentPathFromId(id);
    const now = new Date().toISOString();
    const orgId = getRequestOrgId() ?? null;
    const db = getDb();

    const [existing] = await db
      .select()
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.ownerEmail, userEmail),
          eq(schema.documents.sourceMode, "database"),
          eq(schema.documents.sourceKind, "local-file-copy"),
          eq(schema.documents.sourcePath, sourcePath),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(schema.documents)
        .set({
          title: localDocument.title,
          content: localDocument.content,
          icon: localDocument.icon,
          isFavorite: localDocument.isFavorite ? 1 : 0,
          hideFromSearch: localDocument.hideFromSearch ? 1 : 0,
          sourceRootPath: localDocument.source?.rootPath ?? null,
          sourceUpdatedAt: localDocument.source?.updatedAt ?? now,
          updatedAt: now,
        })
        .where(eq(schema.documents.id, existing.id));

      const [row] = await db
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, existing.id));

      await writeAppState("refresh-signal", { ts: Date.now() });
      return serializeDocument(row);
    }

    const [{ max: maxPosition } = { max: -1 }] = await db
      .select({ max: sql<number>`COALESCE(MAX(position), -1)` })
      .from(schema.documents)
      .where(
        and(eq(schema.documents.ownerEmail, userEmail), sql`parent_id IS NULL`),
      );

    const documentId = nanoid();
    await db.insert(schema.documents).values({
      id: documentId,
      ownerEmail: userEmail,
      orgId,
      parentId: null,
      title: localDocument.title,
      content: localDocument.content,
      icon: localDocument.icon,
      position: (maxPosition ?? -1) + 1,
      isFavorite: localDocument.isFavorite ? 1 : 0,
      hideFromSearch: localDocument.hideFromSearch ? 1 : 0,
      visibility: "private",
      sourceMode: "database",
      sourceKind: "local-file-copy",
      sourcePath,
      sourceRootPath: localDocument.source?.rootPath ?? null,
      sourceUpdatedAt: localDocument.source?.updatedAt ?? now,
      createdAt: now,
      updatedAt: now,
    });

    const [row] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));

    await writeAppState("refresh-signal", { ts: Date.now() });
    return serializeDocument(row);
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
      label: "Open shareable copy",
      view: "editor",
    };
  },
});
