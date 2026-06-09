import { defineAction } from "@agent-native/core";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import {
  documentDiscoveryFilter,
  parseDocumentFavorite,
  parseDocumentHideFromSearch,
} from "../server/lib/documents.js";
import { parseDatabaseViewConfig } from "./_property-utils.js";
import {
  accessFilter,
  ROLE_RANK,
  type ShareRole,
} from "@agent-native/core/sharing";
import { serializeDatabaseMembership } from "./_database-utils.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { z } from "zod";

function contentPreview(content: string, maxLength = 180) {
  const compact = content.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength).trimEnd()}...`;
}

type EffectiveRole = "owner" | ShareRole;

function canEditRole(role: EffectiveRole) {
  return role === "owner" || role === "admin" || role === "editor";
}

function canManageRole(role: EffectiveRole) {
  return role === "owner" || role === "admin";
}

function strongerRole(current: ShareRole | null, next: ShareRole): ShareRole {
  if (!current || ROLE_RANK[next] > ROLE_RANK[current]) return next;
  return current;
}

export default defineAction({
  description:
    "List document metadata ordered by position. Does not return full document bodies; use get-document for one document's content.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const db = getDb();
    const userEmail = getRequestUserEmail();
    const orgId = getRequestOrgId();
    // Projection that deliberately avoids pulling the full `content` blob:
    // document bodies can be multi-MB, and the list/tree path only needs a
    // short preview plus the true length. `substr` truncates the transferred
    // text to the first 400 chars (well above the ~180-char preview, leaving
    // headroom for whitespace collapse), while `length` reports the real size.
    // Both `substr` and `length` work identically on SQLite/libsql and
    // Postgres.
    const documents = await db
      .select({
        id: schema.documents.id,
        parentId: schema.documents.parentId,
        title: schema.documents.title,
        contentSnippet: sql<string>`substr(${schema.documents.content}, 1, 400)`,
        contentLength: sql<number>`length(${schema.documents.content})`,
        icon: schema.documents.icon,
        position: schema.documents.position,
        isFavorite: schema.documents.isFavorite,
        hideFromSearch: schema.documents.hideFromSearch,
        visibility: schema.documents.visibility,
        ownerEmail: schema.documents.ownerEmail,
        orgId: schema.documents.orgId,
        createdAt: schema.documents.createdAt,
        updatedAt: schema.documents.updatedAt,
      })
      .from(schema.documents)
      .where(
        and(
          accessFilter(schema.documents, schema.documentShares),
          documentDiscoveryFilter(),
        ),
      )
      .orderBy(asc(schema.documents.position));

    const shareRoleByDocumentId = new Map<string, ShareRole>();
    const notionPageIdByDocumentId = new Map<string, string>();
    if (documents.length > 0) {
      const notionLinks = await db
        .select({
          documentId: schema.documentSyncLinks.documentId,
          remotePageId: schema.documentSyncLinks.remotePageId,
        })
        .from(schema.documentSyncLinks)
        .where(
          inArray(
            schema.documentSyncLinks.documentId,
            documents.map((d) => d.id),
          ),
        );
      for (const link of notionLinks) {
        notionPageIdByDocumentId.set(link.documentId, link.remotePageId);
      }

      const principalClauses: NonNullable<ReturnType<typeof and>>[] = [];
      if (userEmail) {
        principalClauses.push(
          and(
            eq(schema.documentShares.principalType, "user"),
            eq(schema.documentShares.principalId, userEmail),
          ),
        );
      }
      if (orgId) {
        principalClauses.push(
          and(
            eq(schema.documentShares.principalType, "org"),
            eq(schema.documentShares.principalId, orgId),
          ),
        );
      }

      if (principalClauses.length > 0) {
        const shareRows = await db
          .select({
            resourceId: schema.documentShares.resourceId,
            role: schema.documentShares.role,
          })
          .from(schema.documentShares)
          .where(
            and(
              inArray(
                schema.documentShares.resourceId,
                documents.map((d) => d.id),
              ),
              or(...principalClauses),
            ),
          );

        for (const row of shareRows) {
          shareRoleByDocumentId.set(
            row.resourceId,
            strongerRole(
              shareRoleByDocumentId.get(row.resourceId) ?? null,
              row.role,
            ),
          );
        }
      }
    }

    const databases =
      documents.length > 0
        ? await db
            .select()
            .from(schema.contentDatabases)
            .where(
              inArray(
                schema.contentDatabases.documentId,
                documents.map((d) => d.id),
              ),
            )
        : [];
    const databaseByDocumentId = new Map(
      databases.map((database) => [database.documentId, database]),
    );
    const databaseMemberships =
      documents.length > 0
        ? await db
            .select({
              item: schema.contentDatabaseItems,
              database: schema.contentDatabases,
            })
            .from(schema.contentDatabaseItems)
            .innerJoin(
              schema.contentDatabases,
              eq(
                schema.contentDatabases.id,
                schema.contentDatabaseItems.databaseId,
              ),
            )
            .where(
              inArray(
                schema.contentDatabaseItems.documentId,
                documents.map((d) => d.id),
              ),
            )
        : [];
    const databaseMembershipByDocumentId = new Map(
      databaseMemberships.map((row) => [row.item.documentId, row]),
    );

    const mapped = documents.map((d) => {
      let accessRole: EffectiveRole = "viewer";
      const shareRole = shareRoleByDocumentId.get(d.id) ?? null;
      const database = databaseByDocumentId.get(d.id) ?? null;
      const databaseMembership =
        databaseMembershipByDocumentId.get(d.id) ?? null;

      if (shareRole && ROLE_RANK[shareRole] > ROLE_RANK[accessRole]) {
        accessRole = shareRole;
      }
      if (
        userEmail &&
        d.ownerEmail === userEmail &&
        (orgId ? d.orgId === orgId : !d.orgId)
      ) {
        accessRole = "owner";
      }

      return {
        id: d.id,
        parentId: d.parentId,
        title: d.title,
        contentPreview: contentPreview(d.contentSnippet),
        contentLength: Number(d.contentLength) || 0,
        icon: d.icon,
        position: d.position,
        isFavorite: parseDocumentFavorite(d.isFavorite),
        hideFromSearch: parseDocumentHideFromSearch(d.hideFromSearch),
        notionPageId: notionPageIdByDocumentId.get(d.id) ?? null,
        notionPageUrl: notionPageIdByDocumentId.has(d.id)
          ? `https://www.notion.so/${notionPageIdByDocumentId.get(d.id)!.replace(/-/g, "")}`
          : null,
        visibility: d.visibility,
        database: database
          ? {
              id: database.id,
              documentId: database.documentId,
              title: database.title,
              viewConfig: parseDatabaseViewConfig(database.viewConfigJson),
              createdAt: database.createdAt,
              updatedAt: database.updatedAt,
            }
          : undefined,
        databaseMembership: databaseMembership
          ? serializeDatabaseMembership(databaseMembership)
          : undefined,
        accessRole,
        canEdit: canEditRole(accessRole),
        canManage: canManageRole(accessRole),
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      };
    });

    return { documents: mapped };
  },
});
