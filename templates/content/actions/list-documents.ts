import { defineAction } from "@agent-native/core";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import {
  documentDiscoveryFilter,
  parseDocumentFavorite,
  parseDocumentHideFromSearch,
} from "../server/lib/documents.js";
import {
  accessFilter,
  ROLE_RANK,
  type ShareRole,
} from "@agent-native/core/sharing";
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
    const documents = await db
      .select()
      .from(schema.documents)
      .where(
        and(
          accessFilter(schema.documents, schema.documentShares),
          documentDiscoveryFilter(),
        ),
      )
      .orderBy(asc(schema.documents.position));

    const shareRoleByDocumentId = new Map<string, ShareRole>();
    if (documents.length > 0) {
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

    const mapped = documents.map((d) => {
      let accessRole: EffectiveRole = "viewer";
      const shareRole = shareRoleByDocumentId.get(d.id) ?? null;

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
        contentPreview: contentPreview(d.content),
        contentLength: d.content.length,
        icon: d.icon,
        position: d.position,
        isFavorite: parseDocumentFavorite(d.isFavorite),
        hideFromSearch: parseDocumentHideFromSearch(d.hideFromSearch),
        visibility: d.visibility,
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
