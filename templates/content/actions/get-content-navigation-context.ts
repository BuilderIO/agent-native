import { ActionContractError } from "@agent-native/core";
import { defineAction, fail } from "@agent-native/core/action";
import { alias } from "@agent-native/core/db/schema";
import { parseIconValue, serializeIconValue } from "@agent-native/core/icons";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { accessFilter, type AccessContext } from "@agent-native/core/sharing";
import { and, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type { ContentNavigationContext } from "../shared/api.js";
import { favoriteDocumentIds } from "./_content-favorites.js";
import { resolveContentSpaceAccess } from "./_content-space-access.js";
import { serializeDocumentSource } from "./_document-source.js";
import {
  getContentSourceMode,
  getLocalFileDocument,
  getLocalDocumentContextPath,
  isLocalDocumentId,
} from "./_local-file-documents.js";

const MAX_ANCESTORS = 100;

type NavigationFilesContext = {
  databaseId: string;
  databaseDocumentId: string;
  spaceId: string;
  accessContext: AccessContext;
};

function isContentSpaceAccessDenial(error: unknown): boolean {
  return (
    error instanceof ActionContractError &&
    ["FORBIDDEN", "SPACE_NOT_FOUND"].includes(error.errorCode)
  );
}

async function resolveNavigationFilesContext(
  db: ReturnType<typeof getDb>,
  documentId: string,
): Promise<NavigationFilesContext | undefined> {
  const membershipCandidates = await db
    .select({
      databaseId: schema.contentDatabases.id,
      databaseDocumentId: schema.contentDatabases.documentId,
      spaceId: schema.contentSpaces.id,
    })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.contentDatabases,
      eq(schema.contentDatabases.id, schema.contentDatabaseItems.databaseId),
    )
    .innerJoin(
      schema.contentSpaces,
      eq(schema.contentSpaces.id, schema.contentDatabases.spaceId),
    )
    .where(
      and(
        eq(schema.contentDatabaseItems.documentId, documentId),
        eq(schema.contentDatabases.systemRole, "files"),
        eq(schema.contentSpaces.filesDatabaseId, schema.contentDatabases.id),
        isNull(schema.contentDatabases.deletedAt),
        isNull(schema.contentSpaces.archivedAt),
      ),
    );
  const filesDocumentCandidates = await db
    .select({
      databaseId: schema.contentDatabases.id,
      databaseDocumentId: schema.contentDatabases.documentId,
      spaceId: schema.contentSpaces.id,
    })
    .from(schema.contentDatabases)
    .innerJoin(
      schema.contentSpaces,
      eq(schema.contentSpaces.id, schema.contentDatabases.spaceId),
    )
    .where(
      and(
        eq(schema.contentDatabases.documentId, documentId),
        eq(schema.contentDatabases.systemRole, "files"),
        eq(schema.contentSpaces.filesDatabaseId, schema.contentDatabases.id),
        isNull(schema.contentDatabases.deletedAt),
        isNull(schema.contentSpaces.archivedAt),
      ),
    );
  const candidates = new Map(
    [...membershipCandidates, ...filesDocumentCandidates].map((candidate) => [
      candidate.databaseId,
      candidate,
    ]),
  );
  const authorized: NavigationFilesContext[] = [];
  for (const candidate of candidates.values()) {
    try {
      const access = await resolveContentSpaceAccess(
        candidate.spaceId,
        "viewer",
        { db },
      );
      authorized.push({
        ...candidate,
        accessContext: {
          userEmail: access.authority.userEmail,
          orgId: access.authority.orgId ?? undefined,
        },
      });
    } catch (error) {
      if (!isContentSpaceAccessDenial(error)) throw error;
    }
  }
  if (authorized.length > 1) {
    fail(
      "The document belongs to more than one authoritative Files navigation context.",
      {
        errorCode: "navigation_context_ambiguous",
        statusCode: 409,
      },
    );
  }
  return authorized[0];
}

function permissions(role: string) {
  return {
    accessRole: role as "owner" | "admin" | "editor" | "commenter" | "viewer",
    canView: true,
    canComment: ["owner", "admin", "editor", "commenter"].includes(role),
    canEdit: ["owner", "admin", "editor"].includes(role),
    canManage: ["owner", "admin"].includes(role),
  };
}

export default defineAction({
  description:
    "Read bounded metadata needed to reveal and navigate one Content item without loading its body or enumerating documents.",
  agentTool: false,
  schema: z.object({ id: z.string().min(1) }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ id }): Promise<ContentNavigationContext> => {
    const mode = await getContentSourceMode();
    if (mode === "local-files" && isLocalDocumentId(id)) {
      const document = await getLocalFileDocument(id);
      const contextPath = await getLocalDocumentContextPath(id);
      return {
        mode,
        document: { ...document, content: "" },
        path: [
          ...contextPath.map((entry) => ({
            id: entry.id,
            parentId: null,
            title: entry.title,
            icon: null,
            databaseId: null,
            databaseDocumentId: null,
            isFavorite: false,
            visibility: "private" as const,
            ...permissions("owner"),
            source: document.source,
            createdAt: document.createdAt,
            updatedAt: document.updatedAt,
          })),
          {
            id: document.id,
            parentId: document.parentId,
            title: document.title,
            icon: serializeIconValue(parseIconValue(document.icon)),
            databaseId: null,
            databaseDocumentId: null,
            isFavorite: document.isFavorite,
            visibility: document.visibility,
            accessRole: document.accessRole,
            canView: document.canView,
            canComment: document.canComment,
            canEdit: document.canEdit,
            canManage: document.canManage,
            source: document.source,
            createdAt: document.createdAt,
            updatedAt: document.updatedAt,
          },
        ],
        workspaceFilesDatabaseId: null,
      };
    }

    const db = getDb();
    const databaseDocuments = alias(
      schema.documents,
      "navigation_context_database_documents",
    );
    const path: ContentNavigationContext["path"] = [];
    const userEmail = getRequestUserEmail();
    const navigationFilesContext = await resolveNavigationFilesContext(db, id);
    const accessContext: AccessContext =
      navigationFilesContext?.accessContext ?? {
        userEmail,
        orgId: getRequestOrgId() ?? undefined,
      };
    const orgId = accessContext.orgId;
    const seen = new Set<string>();
    let activeRow: typeof schema.documents.$inferSelect | undefined;
    let activeMembership:
      | { databaseId: string; databaseDocumentId: string }
      | undefined;
    let currentId: string | null = id;
    while (currentId && path.length <= MAX_ANCESTORS) {
      if (seen.has(currentId))
        throw new Error("Document ancestry contains a cycle");
      seen.add(currentId);
      const [row] = await db
        .select({
          id: schema.documents.id,
          spaceId: schema.documents.spaceId,
          parentId: schema.documents.parentId,
          title: schema.documents.title,
          icon: schema.documents.icon,
          position: schema.documents.position,
          description: schema.documents.description,
          visibility: schema.documents.visibility,
          ownerEmail: schema.documents.ownerEmail,
          orgId: schema.documents.orgId,
          isFavorite: schema.documents.isFavorite,
          hideFromSearch: schema.documents.hideFromSearch,
          trashedAt: schema.documents.trashedAt,
          trashRootId: schema.documents.trashRootId,
          bodyRevision: schema.documents.bodyRevision,
          sourceMode: schema.documents.sourceMode,
          sourceKind: schema.documents.sourceKind,
          sourcePath: schema.documents.sourcePath,
          sourceRootPath: schema.documents.sourceRootPath,
          sourceUpdatedAt: schema.documents.sourceUpdatedAt,
          createdAt: schema.documents.createdAt,
          updatedAt: schema.documents.updatedAt,
        })
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.id, currentId),
            isNull(schema.documents.trashedAt),
            accessFilter(
              schema.documents,
              schema.documentShares,
              accessContext,
            ),
          ),
        )
        .limit(1);
      if (!row) {
        if (currentId === id)
          throw Object.assign(new Error(`Document "${id}" not found`), {
            statusCode: 404,
          });
        break;
      }
      const memberships = await db
        .select({
          databaseId: schema.contentDatabaseItems.databaseId,
          databaseDocumentId: schema.contentDatabases.documentId,
          systemRole: schema.contentDatabases.systemRole,
        })
        .from(schema.contentDatabaseItems)
        .innerJoin(
          schema.contentDatabases,
          eq(
            schema.contentDatabases.id,
            schema.contentDatabaseItems.databaseId,
          ),
        )
        .innerJoin(
          schema.contentSpaces,
          eq(schema.contentSpaces.id, schema.contentDatabases.spaceId),
        )
        .innerJoin(
          databaseDocuments,
          eq(databaseDocuments.id, schema.contentDatabases.documentId),
        )
        .where(
          and(
            eq(schema.contentDatabaseItems.documentId, row.id),
            eq(schema.contentDatabases.spaceId, schema.contentSpaces.id),
            eq(
              schema.contentSpaces.filesDatabaseId,
              schema.contentDatabases.id,
            ),
            isNull(schema.contentDatabases.deletedAt),
            eq(schema.contentDatabases.systemRole, "files"),
            isNull(databaseDocuments.trashedAt),
            accessFilter(
              databaseDocuments,
              schema.documentShares,
              accessContext,
            ),
          ),
        )
        .limit(2);
      if (memberships.length > 1) {
        fail(
          "The document belongs to more than one authoritative Files navigation context.",
          {
            errorCode: "navigation_context_ambiguous",
            statusCode: 409,
          },
        );
      }
      const membership = memberships[0];
      const activeFilesDatabase =
        row.id === id &&
        !membership &&
        navigationFilesContext?.databaseDocumentId === row.id
          ? navigationFilesContext
          : undefined;
      const navigationMembership = membership ?? activeFilesDatabase;
      const shareRows = userEmail
        ? await db
            .select({ role: schema.documentShares.role })
            .from(schema.documentShares)
            .where(
              and(
                eq(schema.documentShares.resourceId, row.id),
                or(
                  and(
                    eq(schema.documentShares.principalType, "user"),
                    eq(schema.documentShares.principalId, userEmail),
                  ),
                  ...(orgId
                    ? [
                        and(
                          eq(schema.documentShares.principalType, "org"),
                          eq(schema.documentShares.principalId, orgId),
                        ),
                      ]
                    : []),
                ),
              ),
            )
        : [];
      const role =
        userEmail && row.ownerEmail.toLowerCase() === userEmail.toLowerCase()
          ? "owner"
          : (["admin", "editor", "commenter", "viewer"].find((candidate) =>
              shareRows.some((share) => share.role === candidate),
            ) ?? "viewer");
      path.unshift({
        id: row.id,
        parentId: row.parentId,
        title: row.title,
        icon: row.icon,
        databaseId: navigationMembership?.databaseId ?? null,
        databaseDocumentId: navigationMembership?.databaseDocumentId ?? null,
        isFavorite: false,
        visibility: row.visibility as "private" | "org" | "public",
        ...permissions(role),
        source: serializeDocumentSource(row),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
      currentId = row.parentId;
      if (path.length > MAX_ANCESTORS)
        throw new Error(
          "Document ancestry exceeds the supported navigation depth",
        );
      if (row.id === id) {
        activeRow = row as typeof schema.documents.$inferSelect;
        activeMembership = navigationMembership;
      }
    }
    if (userEmail) {
      const favorites = await favoriteDocumentIds(
        db,
        userEmail,
        path.map((entry) => entry.id),
      );
      for (const entry of path) entry.isFavorite = favorites.has(entry.id);
    }
    return {
      mode,
      document: {
        id: activeRow!.id,
        parentId: activeRow!.parentId,
        title: activeRow!.title,
        content: "",
        description: activeRow!.description,
        icon: activeRow!.icon,
        position: activeRow!.position,
        isFavorite: path[path.length - 1]?.isFavorite ?? false,
        hideFromSearch: false,
        visibility: activeRow!.visibility,
        ...permissions(path[path.length - 1]?.accessRole ?? "viewer"),
        source: serializeDocumentSource(activeRow!),
        createdAt: activeRow!.createdAt,
        updatedAt: activeRow!.updatedAt,
      },
      path,
      workspaceFilesDatabaseId: activeMembership?.databaseId ?? null,
    };
  },
});
