import { defineAction, embedApp } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { parseIconValue, serializeIconValue } from "@agent-native/core/icons";
import { buildDeepLink } from "@agent-native/core/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { bodyRevisionForContent } from "../server/lib/document-body-revision.js";
import {
  parseDocumentFavorite,
  parseDocumentHideFromSearch,
} from "../server/lib/documents.js";
import { setFavoriteMembership } from "./_content-favorites.js";
import { ensureDocumentFilesMembership } from "./_content-files.js";
import {
  organizationContentSpaceId,
  personalContentSpaceId,
  provisionContentSpaces,
} from "./_content-spaces.js";
import { serializeDocumentSource } from "./_document-source.js";
import {
  getLocalFileDocument,
  isLocalFileDocumentId,
  localDocumentPathFromId,
} from "./_local-file-documents.js";
import {
  documentsPositionScope,
  nextAppendPosition,
  withPositionLock,
} from "./_position-utils.js";

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
    "Create or refresh a collection-backed shareable copy of a local-file document. Use this before sharing a local file with other users.",
  schema: z.object({
    id: z.string().describe("Local file document ID to make shareable"),
  }),
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Share document",
      description:
        "Open the shareable collection copy in the real Content editor so the user can invite people or change visibility.",
      iframeTitle: "Agent-Native Content",
      openLabel: "Open in Content",
      height: 900,
    }),
  },
  run: async ({ id }) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) throw new Error("Not authenticated");

    const db = getDb();
    const localDocument = isLocalFileDocumentId(id)
      ? await getLocalFileDocument(id)
      : await db
          .select()
          .from(schema.documents)
          .where(
            and(
              eq(schema.documents.id, id),
              eq(schema.documents.ownerEmail, userEmail),
              eq(schema.documents.sourceMode, "local-files"),
              eq(schema.documents.sourceKind, "file"),
              isNull(schema.documents.trashedAt),
            ),
          )
          .limit(1)
          .then(
            ([row]) =>
              row && {
                title: row.title,
                content: row.content,
                icon: row.icon,
                isFavorite: parseDocumentFavorite(row.isFavorite),
                hideFromSearch: parseDocumentHideFromSearch(row.hideFromSearch),
                source: serializeDocumentSource(row),
              },
          );
    if (!localDocument) {
      throw new Error("Only local file documents can be upgraded for sharing.");
    }
    const sourcePath = isLocalFileDocumentId(id)
      ? localDocumentPathFromId(id)
      : localDocument.source?.path;
    if (!sourcePath) {
      throw new Error("The local file document has no source path.");
    }
    const now = new Date().toISOString();
    const orgId = getRequestOrgId() ?? null;
    const provisioned = await provisionContentSpaces(db, userEmail);
    const targetSpaceId = orgId
      ? organizationContentSpaceId(orgId)
      : personalContentSpaceId(userEmail);
    if (!provisioned.spaceIds.includes(targetSpaceId)) {
      throw new Error(
        "The active organization does not have a writable Content space.",
      );
    }

    const [existing] = await db
      .select()
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.ownerEmail, userEmail),
          eq(schema.documents.sourceMode, "database"),
          eq(schema.documents.sourceKind, "local-file-copy"),
          eq(schema.documents.sourcePath, sourcePath),
          localDocument.source?.rootPath
            ? eq(schema.documents.sourceRootPath, localDocument.source.rootPath)
            : isNull(schema.documents.sourceRootPath),
          or(
            eq(schema.documents.spaceId, targetSpaceId),
            isNull(schema.documents.spaceId),
          ),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(schema.documents)
        .set({
          spaceId: existing.spaceId ?? targetSpaceId,
          title: localDocument.title,
          content: localDocument.content,
          bodyRevision: bodyRevisionForContent(localDocument.content),
          icon:
            typeof localDocument.icon === "string"
              ? localDocument.icon
              : serializeIconValue(parseIconValue(localDocument.icon)),
          isFavorite: localDocument.isFavorite ? 1 : 0,
          hideFromSearch: localDocument.hideFromSearch ? 1 : 0,
          sourceRootPath: localDocument.source?.rootPath ?? null,
          sourceUpdatedAt: localDocument.source?.updatedAt ?? now,
          updatedAt: now,
        })
        .where(eq(schema.documents.id, existing.id));

      await ensureDocumentFilesMembership(db, existing.id, now);
      await setFavoriteMembership({
        db,
        userEmail,
        documentId: existing.id,
        favorite: localDocument.isFavorite,
        now,
      });

      const [row] = await db
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, existing.id));

      await writeAppState("refresh-signal", { ts: Date.now() });
      return serializeDocument(row);
    }

    const documentId = nanoid();
    await withPositionLock(
      documentsPositionScope(userEmail, null),
      async () => {
        const [{ max: maxPosition } = { max: -1 }] = await db
          .select({ max: sql<unknown>`COALESCE(MAX(position), -1)` })
          .from(schema.documents)
          .where(
            and(
              eq(schema.documents.ownerEmail, userEmail),
              sql`parent_id IS NULL`,
            ),
          );

        await db.insert(schema.documents).values({
          id: documentId,
          spaceId: targetSpaceId,
          ownerEmail: userEmail,
          orgId,
          parentId: null,
          title: localDocument.title,
          content: localDocument.content,
          icon:
            typeof localDocument.icon === "string"
              ? localDocument.icon
              : serializeIconValue(parseIconValue(localDocument.icon)),
          position: nextAppendPosition(maxPosition),
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
        await ensureDocumentFilesMembership(db, documentId, now);
        await setFavoriteMembership({
          db,
          userEmail,
          documentId,
          favorite: localDocument.isFavorite,
          now,
        });
      },
    );

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
