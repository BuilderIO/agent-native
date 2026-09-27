import { defineAction } from "@agent-native/core/action";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type { ContentLinkTargetsResponse } from "../shared/api.js";
import { accessibleDocumentIds } from "./_document-access.js";

const MAX_LINK_IDS = 100;
const MAX_SOURCE_PATHS = 20;

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
    "Resolve page-link blocks and local-source references to the Content documents the caller may read. Accepts Content document IDs or Notion page IDs, and source paths of local-source documents; targets the caller cannot read are omitted.",
  agentTool: false,
  schema: z.object({
    ids: z
      .array(z.string().trim().min(1).max(256))
      .max(MAX_LINK_IDS)
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
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ ids, sourcePaths }): Promise<ContentLinkTargetsResponse> => {
    const db = getDb();
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
    const storedNotionPageIds = [...requestedIdsByNotionPage].flatMap(
      ([key, ids]) => [key, dashedNotionPageId(key), ...ids],
    );
    const paths = [
      ...new Set(sourcePaths.map(normalizeSourcePath).filter(Boolean)),
    ];

    const [syncLinks, sourceCandidates] = await Promise.all([
      storedNotionPageIds.length
        ? db
            .select({
              documentId: schema.documentSyncLinks.documentId,
              remotePageId: schema.documentSyncLinks.remotePageId,
            })
            .from(schema.documentSyncLinks)
            .where(
              inArray(schema.documentSyncLinks.remotePageId, [
                ...new Set(storedNotionPageIds),
              ]),
            )
        : [],
      paths.length
        ? db
            .select({
              id: schema.documents.id,
              sourcePath: schema.documents.sourcePath,
            })
            .from(schema.documents)
            .where(
              and(
                eq(schema.documents.sourceMode, "local-files"),
                inArray(schema.documents.sourcePath, [
                  ...paths,
                  ...paths.map((path) => `/${path}`),
                ]),
                isNull(schema.documents.trashedAt),
              ),
            )
            .orderBy(asc(schema.documents.position), asc(schema.documents.id))
        : [],
    ]);

    const candidateIds = [
      ...new Set([
        ...requestedIds,
        ...syncLinks.map((link) => link.documentId),
        ...sourceCandidates.map((candidate) => candidate.id),
      ]),
    ];
    const readable = await accessibleDocumentIds(candidateIds);
    const rows = readable.size
      ? await db
          .select({
            id: schema.documents.id,
            title: schema.documents.title,
            icon: schema.documents.icon,
          })
          .from(schema.documents)
          .where(inArray(schema.documents.id, [...readable]))
      : [];
    const documentById = new Map(rows.map((row) => [row.id, row]));
    const target = (documentId: string) => {
      const row = documentById.get(documentId);
      return row
        ? { documentId: row.id, title: row.title, icon: row.icon }
        : null;
    };

    const links: ContentLinkTargetsResponse["links"] = [];
    const linkedIds = new Set<string>();
    for (const id of requestedIds) {
      const direct = target(id);
      if (!direct) continue;
      links.push({ id, ...direct });
      linkedIds.add(id);
    }
    for (const link of syncLinks) {
      const key = notionPageKey(link.remotePageId);
      const resolved = target(link.documentId);
      if (!key || !resolved) continue;
      for (const id of requestedIdsByNotionPage.get(key) ?? []) {
        if (linkedIds.has(id)) continue;
        links.push({ id, ...resolved });
        linkedIds.add(id);
      }
    }

    const sources: ContentLinkTargetsResponse["sources"] = [];
    for (const path of paths) {
      const match = sourceCandidates.find(
        (candidate) =>
          normalizeSourcePath(candidate.sourcePath ?? "") === path &&
          documentById.has(candidate.id),
      );
      if (match) sources.push({ sourcePath: path, ...target(match.id)! });
    }
    return { links, sources };
  },
});
