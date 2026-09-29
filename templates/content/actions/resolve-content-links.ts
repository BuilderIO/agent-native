import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type { ContentLinkTargetsResponse } from "../shared/api.js";
import {
  CONTENT_LINK_BATCH_MAX,
  isContentLinkId,
} from "../shared/content-links.js";
import { listContentOrganizationMemberships } from "./_content-space-access.js";
import { documentDiscoveryWhere } from "./_document-discovery-query.js";

const MAX_SOURCE_PATHS = 10;

function notionPageKey(value: string): string | null {
  const hex = /^[0-9a-fA-F-]{36}$/.test(value)
    ? value.replace(/-/g, "")
    : value;
  return /^[0-9a-fA-F]{32}$/.test(hex) ? hex.toLowerCase() : null;
}

function dashedNotionPageId(key: string) {
  return `${key.slice(0, 8)}-${key.slice(8, 12)}-${key.slice(12, 16)}-${key.slice(16, 20)}-${key.slice(20)}`;
}

function normalizeSourcePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

export default defineAction({
  description:
    "Resolve page-link blocks and local-source references to the Content documents the caller can list. Accepts Content document IDs or Notion page IDs, and source paths of local-source documents; targets outside the caller's listable documents are omitted.",
  agentTool: false,
  schema: z.object({
    ids: z
      .array(
        z
          .string()
          .refine(
            isContentLinkId,
            "Page-link ids are 1-256 trimmed characters",
          ),
      )
      .max(CONTENT_LINK_BATCH_MAX)
      .default([])
      .describe(
        "Content document IDs or Notion page IDs from page-link blocks",
      ),
    sourcePaths: z
      .array(z.string().trim().min(1).max(1024))
      .max(MAX_SOURCE_PATHS)
      .default([])
      .describe(
        "Source paths of local-source documents, relative to their root",
      ),
    fromDocumentId: z
      .string()
      .min(1)
      .max(256)
      .optional()
      .describe(
        "Document holding the references; matches in its source root win",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({
    ids,
    sourcePaths,
    fromDocumentId,
  }): Promise<ContentLinkTargetsResponse> => {
    const db = getDb();
    const userEmail = getRequestUserEmail();
    const activeOrgId = getRequestOrgId();
    const authorizedOrgIds = [
      ...new Set([
        ...(userEmail
          ? (await listContentOrganizationMemberships(userEmail)).map(
              (membership) => membership.orgId,
            )
          : []),
        ...(!userEmail && activeOrgId ? [activeOrgId] : []),
      ]),
    ];
    // Every lookup matches only documents the caller could list, as the
    // workspace walk did: no public-only, trashed, or deleted-collection rows.
    const listable = (additional: SQL | undefined) =>
      documentDiscoveryWhere({ userEmail, authorizedOrgIds, additional });
    const ownFirst = userEmail
      ? [
          sql`CASE WHEN lower(${schema.documents.ownerEmail}) = ${userEmail.trim().toLowerCase()} THEN 0 ELSE 1 END`,
        ]
      : [];
    const stableOrder = [
      asc(schema.documents.position),
      asc(schema.documents.id),
    ];
    const target = {
      documentId: schema.documents.id,
      title: schema.documents.title,
      icon: schema.documents.icon,
    };

    const requestedIds = [...new Set(ids)];
    const requestedIdsByNotionPage = new Map<string, string[]>();
    for (const id of requestedIds) {
      const key = notionPageKey(id);
      if (!key) continue;
      requestedIdsByNotionPage.set(key, [
        ...(requestedIdsByNotionPage.get(key) ?? []),
        id,
      ]);
    }
    const storedNotionPageIds = [
      ...new Set(
        [...requestedIdsByNotionPage].flatMap(([key, forms]) => [
          key,
          dashedNotionPageId(key),
          ...forms,
        ]),
      ),
    ];
    const paths = [
      ...new Set(sourcePaths.map(normalizeSourcePath).filter(Boolean)),
    ];

    const resolveSources = async () => {
      if (paths.length === 0) return [];
      const [origin] = fromDocumentId
        ? await db
            .select({ sourceRootPath: schema.documents.sourceRootPath })
            .from(schema.documents)
            .where(listable(eq(schema.documents.id, fromDocumentId)))
            .limit(1)
        : [];
      const sameRootFirst = origin?.sourceRootPath
        ? [
            sql`CASE WHEN ${schema.documents.sourceRootPath} = ${origin.sourceRootPath} THEN 0 ELSE 1 END`,
          ]
        : [];
      const matches = await Promise.all(
        paths.map(async (sourcePath) => {
          const [match] = await db
            .select(target)
            .from(schema.documents)
            .where(
              listable(
                and(
                  eq(schema.documents.sourceMode, "local-files"),
                  inArray(schema.documents.sourcePath, [
                    sourcePath,
                    `/${sourcePath}`,
                  ]),
                ),
              ),
            )
            .orderBy(...sameRootFirst, ...ownFirst, ...stableOrder)
            .limit(1);
          return match ? [{ sourcePath, ...match }] : [];
        }),
      );
      return matches.flat();
    };

    const [direct, notionLinked, sources] = await Promise.all([
      requestedIds.length
        ? db
            .select(target)
            .from(schema.documents)
            .where(listable(inArray(schema.documents.id, requestedIds)))
        : [],
      storedNotionPageIds.length
        ? db
            .select({
              remotePageId: schema.documentSyncLinks.remotePageId,
              ...target,
            })
            .from(schema.documentSyncLinks)
            .innerJoin(
              schema.documents,
              eq(schema.documents.id, schema.documentSyncLinks.documentId),
            )
            .where(
              listable(
                inArray(
                  schema.documentSyncLinks.remotePageId,
                  storedNotionPageIds,
                ),
              ),
            )
            .orderBy(...ownFirst, ...stableOrder)
        : [],
      resolveSources(),
    ]);

    const links: ContentLinkTargetsResponse["links"] = direct.map((row) => ({
      id: row.documentId,
      ...row,
    }));
    const linkedIds = new Set(links.map((link) => link.id));
    for (const { remotePageId, ...row } of notionLinked) {
      const key = notionPageKey(remotePageId);
      for (const id of (key && requestedIdsByNotionPage.get(key)) || []) {
        if (linkedIds.has(id)) continue;
        links.push({ id, ...row });
        linkedIds.add(id);
      }
    }
    return { links, sources };
  },
});
