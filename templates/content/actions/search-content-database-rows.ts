import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { getDatabaseMutationContract } from "./_database-row-mutation.js";
import { resolveContentDatabaseRead } from "./_database-utils.js";
import { documentDiscoveryPagination } from "./_document-discovery-query.js";

function escapeLike(s: string): string {
  return s.replace(/([\\%_])/g, "\\$1");
}

export default defineAction({
  description:
    "Search one Content collection's rows by title. Returns row document IDs to use as relation property values, in collection order, with explicit pagination.",
  mcpTool: true,
  schema: z.object({
    databaseId: z.string().min(1).describe("Exact Content collection ID"),
    query: z
      .string()
      .max(200)
      .optional()
      .describe("Optional case-insensitive title search text"),
    limit: z.coerce.number().int().min(1).max(50).default(25),
    offset: z.coerce.number().int().min(0).default(0),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const resolution = await resolveContentDatabaseRead({
      databaseId: args.databaseId,
    });
    if (!resolution.available) throw new Error(resolution.message);
    const database = resolution.database;
    if (database.systemRole) {
      throw new Error("System collections cannot be linked.");
    }

    const db = getDb();
    const query = args.query?.trim().toLowerCase() ?? "";
    const where = and(
      eq(schema.contentDatabaseItems.databaseId, database.id),
      isNull(schema.documents.trashedAt),
      query
        ? sql`lower(${schema.documents.title}) like ${`%${escapeLike(query)}%`} escape '\\'`
        : undefined,
    );
    const rows = await db
      .select({
        documentId: schema.documents.id,
        title: schema.documents.title,
        icon: schema.documents.icon,
      })
      .from(schema.contentDatabaseItems)
      .innerJoin(
        schema.documents,
        eq(schema.documents.id, schema.contentDatabaseItems.documentId),
      )
      .where(where)
      .orderBy(
        asc(schema.contentDatabaseItems.position),
        asc(schema.contentDatabaseItems.id),
      )
      .limit(args.limit)
      .offset(args.offset);
    const [total] = await db
      .select({ value: count() })
      .from(schema.contentDatabaseItems)
      .innerJoin(
        schema.documents,
        eq(schema.documents.id, schema.contentDatabaseItems.documentId),
      )
      .where(where);

    // Editors may create a new row from the picker; hand them the target and
    // schema revision add-database-item needs.
    let rowCreation: {
      target: Awaited<ReturnType<typeof getDatabaseMutationContract>>["target"];
      schemaRevision: string;
    } | null = null;
    if (database.spaceId) {
      const canEdit = await assertAccess(
        "document",
        database.documentId,
        "editor",
      ).then(
        () => true,
        () => false,
      );
      if (canEdit) {
        const contract = await getDatabaseMutationContract({
          spaceId: database.spaceId,
          databaseId: database.id,
          databaseDocumentId: database.documentId,
          authorityScope: database.orgId
            ? { kind: "organization", id: database.orgId }
            : { kind: "personal", id: database.ownerEmail },
        });
        rowCreation = {
          target: contract.target,
          schemaRevision: contract.schemaRevision,
        };
      }
    }

    return {
      databaseId: database.id,
      databaseDocumentId: database.documentId,
      rowCreation,
      rows: rows.map((row) => ({
        documentId: row.documentId,
        title: row.title || "Untitled",
        icon: row.icon ?? null,
      })),
      pagination: documentDiscoveryPagination({
        offset: args.offset,
        limit: args.limit,
        totalItems: Number(total?.value ?? 0),
        returnedItems: rows.length,
      }),
    };
  },
});
