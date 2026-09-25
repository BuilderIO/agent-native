import { getRequestOrgId } from "@agent-native/core/server/request-context";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  contentRecentTargetKey,
  type ContentRecentEntry,
  type ContentRecentResult,
} from "../shared/content-personal-navigation.js";
import { readPersonalDatabaseViewOverrides } from "./_content-database-personal-view.js";
import { favoriteDocumentIds } from "./_content-favorites.js";
import { resolveContentSpaceAccess } from "./_content-space-access.js";
import { documentDiscoveryWhere } from "./_document-discovery-query.js";
import { parseDatabaseViewConfig } from "./_property-utils.js";

export function contentRecentSettingKey() {
  return `content-recent:${JSON.stringify(getRequestOrgId() ?? null)}`;
}

const viewIdentitySchema = z.object({
  views: z
    .array(z.object({ id: z.string().trim().min(1), name: z.string() }))
    .optional(),
});

/**
 * Attach the requesting user's pinned state to already access-resolved Recent
 * rows, so Recent can offer Pin/Unpin without a second client lookup.
 */
export async function withRecentPinnedState(
  userEmail: string,
  entries: ContentRecentResult[],
): Promise<ContentRecentResult[]> {
  if (entries.length === 0) return entries;
  const pinned = await favoriteDocumentIds(
    getDb(),
    userEmail,
    entries.map((entry) => entry.target.documentId),
  );
  return entries.map((entry) => ({
    ...entry,
    isFavorite: pinned.has(entry.target.documentId),
  }));
}

export async function resolveContentRecentEntries(
  userEmail: string,
  entries: ContentRecentEntry[],
  spaceId?: string,
): Promise<ContentRecentResult[]> {
  if (entries.length === 0) return [];
  const db = getDb();
  const orgId = getRequestOrgId();
  let scopedEntries = entries;
  if (spaceId) {
    const access = await resolveContentSpaceAccess(spaceId, "viewer", { db });
    if (access.space.orgId && access.space.orgId !== orgId) return [];
    const memberships = await db
      .select({ documentId: schema.contentDatabaseItems.documentId })
      .from(schema.contentDatabaseItems)
      .where(
        and(
          eq(
            schema.contentDatabaseItems.databaseId,
            access.space.filesDatabaseId,
          ),
          inArray(
            schema.contentDatabaseItems.documentId,
            entries.map((entry) => entry.target.documentId),
          ),
        ),
      );
    const memberIds = new Set(memberships.map((row) => row.documentId));
    scopedEntries = entries.filter((entry) =>
      memberIds.has(entry.target.documentId),
    );
  }
  if (scopedEntries.length === 0) return [];
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
          scopedEntries.map((entry) => entry.target.documentId),
        ),
      }),
    );
  const byId = new Map(documents.map((document) => [document.id, document]));
  const databaseEntries = scopedEntries.filter(
    (entry) => entry.target.databaseId,
  );
  const viewDocumentIds = databaseEntries
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
              or(
                inArray(schema.contentDatabases.documentId, viewDocumentIds),
                inArray(
                  schema.contentDatabases.id,
                  databaseEntries.map((entry) => entry.target.databaseId!),
                ),
              ),
              isNull(schema.contentDatabases.deletedAt),
            ),
          );
  const databasesById = new Map(
    databases.map((database) => [database.id, database]),
  );
  const missingBackingDocumentIds = databases
    .map((database) => database.documentId)
    .filter((documentId) => !byId.has(documentId));
  if (missingBackingDocumentIds.length > 0) {
    const backingDocuments = await db
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
          additional: inArray(schema.documents.id, missingBackingDocumentIds),
        }),
      );
    for (const document of backingDocuments) byId.set(document.id, document);
  }
  const results: ContentRecentResult[] = [];
  const seen = new Set<string>();
  for (const entry of scopedEntries) {
    const database = entry.target.databaseId
      ? databasesById.get(entry.target.databaseId)
      : undefined;
    const document = byId.get(database?.documentId ?? entry.target.documentId);
    if (!document) continue;
    let viewName: string | null = null;
    let target = database
      ? { ...entry.target, documentId: database.documentId }
      : entry.target;
    let fallback: ContentRecentResult["fallback"];
    if (entry.target.databaseId) {
      if (!database || database.documentId !== document.id) continue;
      if (entry.target.viewId) {
        // Validate before the legacy parser, which otherwise coerces unreadable JSON to a default.
        viewIdentitySchema.parse(JSON.parse(database.viewConfigJson));
        const config = parseDatabaseViewConfig(database.viewConfigJson);
        const view = config.views.find(
          (candidate) => candidate.id === entry.target.viewId,
        );
        if (view) {
          viewName = view.name;
        } else {
          const personal = await readPersonalDatabaseViewOverrides(
            userEmail,
            database.id,
          );
          const fallbackView =
            config.views.find(
              (candidate) => candidate.id === personal?.activeViewId,
            ) ??
            config.views.find(
              (candidate) => candidate.id === config.activeViewId,
            ) ??
            config.views[0];
          if (!fallbackView) continue;
          target = {
            documentId: document.id,
            databaseId: database.id,
            viewId: fallbackView.id,
          };
          viewName = fallbackView.name;
          fallback = {
            reason: "saved_view_unavailable",
            requestedViewId: entry.target.viewId,
          };
        }
      }
    }
    const key = contentRecentTargetKey(entry.target);
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      ...entry,
      target,
      title: document.title,
      icon: document.icon,
      viewName,
      ...(fallback ? { fallback } : {}),
    });
  }
  return results;
}
