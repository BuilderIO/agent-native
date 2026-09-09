import { getRequestOrgId } from "@agent-native/core/server/request-context";
import { and, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  contentRecentTargetKey,
  type ContentRecentEntry,
  type ContentRecentResult,
} from "../shared/content-personal-navigation.js";
import { documentDiscoveryWhere } from "./_document-discovery-query.js";

export function contentRecentSettingKey() {
  return `content-recent:${JSON.stringify(getRequestOrgId() ?? null)}`;
}

const viewIdentitySchema = z.object({
  views: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
});

export async function resolveContentRecentEntries(
  userEmail: string,
  entries: ContentRecentEntry[],
): Promise<ContentRecentResult[]> {
  if (entries.length === 0) return [];
  const db = getDb();
  const orgId = getRequestOrgId();
  const documents = await db
    .select({
      id: schema.documents.id,
      title: schema.documents.title,
      icon: schema.documents.icon,
    })
    .from(schema.documents)
    .where(
      documentDiscoveryWhere({
        userEmail,
        authorizedOrgIds: orgId ? [orgId] : [],
        additional: inArray(
          schema.documents.id,
          entries.map((entry) => entry.target.documentId),
        ),
      }),
    );
  const byId = new Map(documents.map((document) => [document.id, document]));
  const viewDocumentIds = entries
    .filter(
      (entry) => entry.target.databaseId && byId.has(entry.target.documentId),
    )
    .map((entry) => entry.target.documentId);
  const databases =
    viewDocumentIds.length === 0
      ? []
      : await db
          .select({
            id: schema.contentDatabases.id,
            documentId: schema.contentDatabases.documentId,
            viewConfigJson: schema.contentDatabases.viewConfigJson,
          })
          .from(schema.contentDatabases)
          .where(
            and(
              inArray(schema.contentDatabases.documentId, viewDocumentIds),
              isNull(schema.contentDatabases.deletedAt),
            ),
          );
  const databasesById = new Map(
    databases.map((database) => [database.id, database]),
  );
  const results: ContentRecentResult[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const document = byId.get(entry.target.documentId);
    if (!document) continue;
    let viewName: string | null = null;
    if (entry.target.databaseId) {
      const database = databasesById.get(entry.target.databaseId);
      if (!database || database.documentId !== document.id) continue;
      if (entry.target.viewId) {
        // Do not normalize a missing exact View into the database's default View.
        const config = viewIdentitySchema.parse(
          JSON.parse(database.viewConfigJson),
        );
        const view = config.views?.find(
          (candidate) => candidate.id === entry.target.viewId,
        );
        if (!view) continue;
        viewName = view.name;
      }
    }
    const key = contentRecentTargetKey(entry.target);
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      ...entry,
      title: document.title,
      icon: document.icon,
      viewName,
    });
  }
  return results;
}
