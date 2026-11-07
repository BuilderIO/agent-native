import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { and, desc, eq, exists, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { listContentOrganizationMemberships } from "./_content-space-access.js";
import { documentDiscoveryWhere } from "./_document-discovery-query.js";

/** Most pages one reply lists; a larger library keeps its latest edited. */
export const DOCUMENT_TITLE_LIST_LIMIT = 20_000;

export default defineAction({
  description:
    "List the title and place of every page the caller can search, latest edited first, for the browser to rank titles on each keystroke. Returns no bodies.",
  agentTool: false,
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  mcpAnnotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async () => {
    const db = getDb();
    const userEmail = getRequestUserEmail();
    const activeOrgId = getRequestOrgId();
    const memberships = userEmail
      ? await listContentOrganizationMemberships(userEmail)
      : [];
    const authorizedOrgIds = [
      ...new Set([
        ...memberships.map((membership) => membership.orgId),
        ...(!userEmail && activeOrgId ? [activeOrgId] : []),
      ]),
    ];
    const documents = await db
      .select({
        id: schema.documents.id,
        parentId: schema.documents.parentId,
        spaceId: schema.documents.spaceId,
        title: schema.documents.title,
        updatedAt: schema.documents.updatedAt,
        sourceKind: schema.documents.sourceKind,
        sourceUpdatedAt: schema.documents.sourceUpdatedAt,
        documentType: sql<"page" | "database">`case when ${exists(
          db
            .select({ id: schema.contentDatabases.id })
            .from(schema.contentDatabases)
            .where(
              and(
                eq(schema.contentDatabases.documentId, schema.documents.id),
                isNull(schema.contentDatabases.deletedAt),
              ),
            ),
        )} then 'database' else 'page' end`,
        // The collection this page is a row of. A workspace's own Files
        // collection isn't one: `spaceId` already says where those pages are.
        collectionDocumentId: sql<string | null>`(${db
          .select({ documentId: schema.contentDatabases.documentId })
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
              eq(schema.contentDatabaseItems.documentId, schema.documents.id),
              isNull(schema.contentDatabases.deletedAt),
              isNull(schema.contentDatabases.systemRole),
            ),
          )
          .orderBy(schema.contentDatabases.id)
          .limit(1)})`,
      })
      .from(schema.documents)
      .where(
        documentDiscoveryWhere({
          userEmail,
          authorizedOrgIds,
          additional: or(
            eq(schema.documents.hideFromSearch, 0),
            isNull(schema.documents.hideFromSearch),
          ),
        }),
      )
      .orderBy(desc(schema.documents.updatedAt), schema.documents.id)
      .limit(DOCUMENT_TITLE_LIST_LIMIT + 1);
    const listed = documents.slice(0, DOCUMENT_TITLE_LIST_LIMIT);
    // A parent or collection outside the list may be one the caller can't
    // open, so its id stays out, as search leaves out such a parent.
    const listedIds = new Set(listed.map((document) => document.id));
    const inList = (id: string | null) => (id && listedIds.has(id) ? id : null);
    return {
      documents: listed.map((document) => ({
        ...document,
        parentId: inList(document.parentId),
        collectionDocumentId: inList(document.collectionDocumentId),
      })),
      truncated: documents.length > DOCUMENT_TITLE_LIST_LIMIT,
    };
  },
});
