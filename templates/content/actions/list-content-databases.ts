import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { accessFilter } from "@agent-native/core/sharing";
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { documentDiscoveryFilter } from "../server/lib/documents.js";
import type { ListContentDatabasesResponse } from "../shared/api.js";
import {
  listContentOrganizationMemberships,
  normalizeContentSpaceEmail,
  resolveContentSpaceAccess,
} from "./_content-space-access.js";
import { documentDiscoveryPagination } from "./_document-discovery-query.js";

const DEFAULT_CONTENT_DATABASE_DISCOVERY_LIMIT = 50;

function escapeLike(s: string): string {
  return s.replace(/([\\%_])/g, "\\$1");
}

export class ContentDatabaseResolutionError extends Error {}

export default defineAction({
  description:
    "Discover one bounded page of ordinary Content databases the user can access from their live title and user-authored description. Returns stable database, document, and space IDs with explicit pagination; follow nextOffset until hasMore is false. Use exact filters before reading a selected database's schema. Set includeSystemCollections to classify Files, Favorites, Workspaces, and other system chrome separately from ordinary databases.",
  schema: z.object({
    spaceId: z
      .string()
      .min(1)
      .optional()
      .describe("Exact Content space ID to search within."),
    databaseId: z
      .string()
      .min(1)
      .optional()
      .describe("Exact Content database ID to resolve."),
    includeSystemCollections: z
      .boolean()
      .optional()
      .describe(
        "Return system-role databases in systemCollections instead of treating them as ordinary databases.",
      ),
    documentId: z
      .string()
      .min(1)
      .optional()
      .describe("Exact Content database document/page ID to resolve."),
    title: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Exact live database title to resolve, case-insensitively."),
    excludeDatabaseId: z
      .string()
      .optional()
      .describe("Database id to omit from the results."),
    excludeDatabaseIds: z
      .array(z.string())
      .optional()
      .describe("Database ids to omit from the results."),
    query: z
      .string()
      .optional()
      .describe("Optional title or user-authored description search text."),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .default(DEFAULT_CONTENT_DATABASE_DISCOVERY_LIMIT)
      .describe("Maximum number of databases to return. Defaults to 50."),
    offset: z.coerce
      .number()
      .int()
      .min(0)
      .default(0)
      .describe("Zero-based continuation offset."),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async (args): Promise<ListContentDatabasesResponse> => {
    if (args.includeSystemCollections && !args.spaceId) {
      throw new ContentDatabaseResolutionError(
        "An exact spaceId is required to inventory system collections.",
      );
    }
    const db = getDb();
    const requestUserEmail = getRequestUserEmail();
    if (!requestUserEmail) throw new Error("no authenticated user");
    const normalizedUserEmail = normalizeContentSpaceEmail(requestUserEmail);
    const authorizedOrganizationIds = (
      await listContentOrganizationMemberships(normalizedUserEmail)
    ).map((membership) => membership.orgId);
    if (args.spaceId) {
      await resolveContentSpaceAccess(args.spaceId, "viewer", { db });
    }
    const query = args.query?.trim();
    const pattern = query ? `%${escapeLike(query.toLowerCase())}%` : null;
    const exactTitle = args.title?.toLowerCase();
    const resolvesExactly = !!(
      args.databaseId ||
      args.documentId ||
      exactTitle
    );
    const excludedDatabaseIds = new Set(
      [
        args.excludeDatabaseId?.trim(),
        ...(args.excludeDatabaseIds ?? []).map((id) => id.trim()),
      ].filter((id): id is string => !!id),
    );
    const localTableSources =
      excludedDatabaseIds.size > 0
        ? await db
            .select({
              databaseId: schema.contentDatabaseSources.databaseId,
              sourceTable: schema.contentDatabaseSources.sourceTable,
            })
            .from(schema.contentDatabaseSources)
            .where(eq(schema.contentDatabaseSources.sourceType, "local-table"))
        : [];
    const excludedDatabaseRows =
      excludedDatabaseIds.size > 0
        ? await db
            .select({ id: schema.contentDatabases.id })
            .from(schema.contentDatabases)
            .innerJoin(
              schema.documents,
              eq(schema.contentDatabases.documentId, schema.documents.id),
            )
            .where(
              and(
                accessFilter(schema.documents, schema.documentShares),
                or(
                  inArray(
                    schema.contentDatabases.id,
                    Array.from(excludedDatabaseIds),
                  ),
                  inArray(
                    schema.contentDatabases.documentId,
                    Array.from(excludedDatabaseIds),
                  ),
                ),
              ),
            )
        : [];
    const excludedSourceChainDatabaseIds = new Set([
      ...excludedDatabaseIds,
      ...excludedDatabaseRows.map((row) => row.id),
    ]);
    let expandedSourceChain = true;
    while (expandedSourceChain) {
      expandedSourceChain = false;
      for (const source of localTableSources) {
        if (
          excludedSourceChainDatabaseIds.has(source.sourceTable) &&
          !excludedSourceChainDatabaseIds.has(source.databaseId)
        ) {
          excludedSourceChainDatabaseIds.add(source.databaseId);
          expandedSourceChain = true;
        }
      }
    }

    // The same access + discovery filter the sidebar uses, so the picker shows
    // owned AND shared/org databases and never a trashed/hidden one. Resolve
    // source-chain exclusions before limiting so every page is truthfully full.
    const where = and(
      accessFilter(schema.documents, schema.documentShares),
      isNull(schema.documents.trashedAt),
      documentDiscoveryFilter(),
      or(
        eq(schema.documents.hideFromSearch, 0),
        isNull(schema.documents.hideFromSearch),
      ),
      isNull(schema.contentDatabases.deletedAt),
      isNull(schema.contentSpaces.archivedAt),
      or(
        isNull(schema.contentDatabases.spaceId),
        and(
          isNotNull(schema.contentSpaces.id),
          or(
            sql`LOWER(${schema.contentSpaces.ownerEmail}) = ${normalizedUserEmail}`,
            authorizedOrganizationIds.length > 0
              ? inArray(schema.contentSpaces.orgId, authorizedOrganizationIds)
              : undefined,
          ),
        ),
      ),
      isNull(schema.contentDatabases.systemRole),
      args.spaceId
        ? eq(schema.contentDatabases.spaceId, args.spaceId)
        : undefined,
      args.databaseId
        ? eq(schema.contentDatabases.id, args.databaseId)
        : undefined,
      args.documentId
        ? eq(schema.contentDatabases.documentId, args.documentId)
        : undefined,
      exactTitle
        ? sql`lower(${schema.documents.title}) = ${exactTitle}`
        : undefined,
      excludedSourceChainDatabaseIds.size > 0
        ? notInArray(
            schema.contentDatabases.id,
            Array.from(excludedSourceChainDatabaseIds),
          )
        : undefined,
      excludedDatabaseIds.size > 0
        ? notInArray(
            schema.contentDatabases.documentId,
            Array.from(excludedDatabaseIds),
          )
        : undefined,
      pattern
        ? or(
            sql`lower(${schema.documents.title}) LIKE ${pattern} ESCAPE '\\'`,
            sql`lower(${schema.documents.description}) LIKE ${pattern} ESCAPE '\\'`,
          )
        : undefined,
    );
    const baseQuery = () =>
      db
        .select({
          id: schema.contentDatabases.id,
          documentId: schema.contentDatabases.documentId,
          title: schema.documents.title,
          description: schema.documents.description,
          spaceId: schema.contentDatabases.spaceId,
        })
        .from(schema.contentDatabases)
        .innerJoin(
          schema.documents,
          eq(schema.contentDatabases.documentId, schema.documents.id),
        )
        .leftJoin(
          schema.contentSpaces,
          eq(schema.contentDatabases.spaceId, schema.contentSpaces.id),
        )
        .where(where)
        .orderBy(
          asc(schema.documents.position),
          asc(schema.contentDatabases.id),
        );

    // Two visible matches are sufficient to reject an exact selector without
    // materializing every duplicate-title row.
    const rows = resolvesExactly
      ? await baseQuery().limit(2)
      : await baseQuery().limit(args.limit).offset(args.offset);

    if (resolvesExactly && rows.length !== 1) {
      const selector = args.databaseId
        ? `database ID "${args.databaseId}"`
        : args.documentId
          ? `document ID "${args.documentId}"`
          : `title "${args.title?.trim()}"`;
      throw new ContentDatabaseResolutionError(
        rows.length === 0
          ? `No accessible Content database matched exact ${selector}.`
          : `Exact ${selector} is ambiguous across multiple accessible Content databases.`,
      );
    }

    const databases = rows.map((row) => ({
      databaseId: row.id,
      documentId: row.documentId,
      spaceId: row.spaceId,
      // The document's live title (matches the sidebar) rather than the
      // possibly-stale content_databases.title.
      title: row.title ?? "Untitled database",
      description: row.description,
    }));

    const totalItems = resolvesExactly
      ? databases.length
      : Number(
          (
            await db
              .select({ count: sql<number>`count(*)` })
              .from(schema.contentDatabases)
              .innerJoin(
                schema.documents,
                eq(schema.contentDatabases.documentId, schema.documents.id),
              )
              .leftJoin(
                schema.contentSpaces,
                eq(schema.contentDatabases.spaceId, schema.contentSpaces.id),
              )
              .where(where)
          )[0]?.count ?? 0,
        );

    const systemCollections = args.includeSystemCollections
      ? await db
          .select({
            databaseId: schema.contentDatabases.id,
            documentId: schema.contentDatabases.documentId,
            title: schema.documents.title,
            spaceId: schema.contentDatabases.spaceId,
            spaceName: schema.contentSpaces.name,
            spaceKind: schema.contentSpaces.kind,
            systemRole: schema.contentDatabases.systemRole,
          })
          .from(schema.contentDatabases)
          .innerJoin(
            schema.documents,
            eq(schema.contentDatabases.documentId, schema.documents.id),
          )
          .leftJoin(
            schema.contentSpaces,
            eq(schema.contentDatabases.spaceId, schema.contentSpaces.id),
          )
          .where(
            and(
              accessFilter(schema.documents, schema.documentShares),
              isNull(schema.documents.trashedAt),
              isNull(schema.contentDatabases.deletedAt),
              isNull(schema.contentSpaces.archivedAt),
              isNotNull(schema.contentSpaces.id),
              isNotNull(schema.contentDatabases.systemRole),
              eq(schema.contentDatabases.spaceId, args.spaceId!),
            ),
          )
          .orderBy(
            asc(schema.documents.position),
            asc(schema.contentDatabases.id),
          )
      : undefined;

    return {
      databases,
      pagination: documentDiscoveryPagination({
        offset: resolvesExactly ? 0 : args.offset,
        limit: args.limit,
        totalItems,
        returnedItems: databases.length,
      }),
      ...(systemCollections
        ? {
            systemCollections: systemCollections.map((collection) => ({
              ...collection,
              title: collection.title ?? "Untitled database",
              systemRole: collection.systemRole!,
            })),
          }
        : {}),
    };
  },
});
