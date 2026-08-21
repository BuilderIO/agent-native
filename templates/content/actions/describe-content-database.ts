import { defineAction } from "@agent-native/core";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { getDocumentContextPath } from "../server/lib/document-context.js";
import type {
  ContentDatabaseDescriptionResponse,
  ContentDatabaseUnavailableResponse,
} from "../shared/api.js";
import { resolveContentDatabaseRead } from "./_database-utils.js";
import {
  listPropertiesForDatabase,
  serializeDatabase,
} from "./_property-utils.js";
import listContentDatabases, {
  ContentDatabaseResolutionError,
} from "./list-content-databases.js";

export default defineAction({
  description:
    "Describe one exact ordinary Content database, including its live metadata, views, and property schema but not its rows. Resolve the stable database or document ID with list-content-databases first.",
  schema: z
    .object({
      databaseId: z.string().min(1).optional().describe("Exact database ID"),
      documentId: z
        .string()
        .min(1)
        .optional()
        .describe("Exact database document/page ID"),
    })
    .refine(
      (input) => Boolean(input.databaseId) !== Boolean(input.documentId),
      "Provide exactly one of databaseId or documentId.",
    ),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async ({
    databaseId,
    documentId,
  }): Promise<
    ContentDatabaseDescriptionResponse | ContentDatabaseUnavailableResponse
  > => {
    let selection: Awaited<ReturnType<typeof listContentDatabases.run>>;
    try {
      selection = await listContentDatabases.run({ databaseId, documentId });
    } catch (error) {
      if (!(error instanceof ContentDatabaseResolutionError)) throw error;
      throw new Error("Content database not found.");
    }
    const selected = selection.databases[0];
    if (!selected) throw new Error("Content database not found.");

    const resolved = await resolveContentDatabaseRead({
      databaseId: selected.databaseId,
    });
    if (!resolved.available) return resolved;
    if (resolved.database.systemRole) {
      throw new Error("Content database not found.");
    }

    const db = getDb();
    const [databaseDocument] = await db
      .select({
        id: schema.documents.id,
        parentId: schema.documents.parentId,
      })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.id, selected.documentId),
          accessFilter(schema.documents, schema.documentShares),
        ),
      );
    if (!databaseDocument) throw new Error("Content database not found.");

    const [properties, contextPath] = await Promise.all([
      listPropertiesForDatabase(resolved.database.id),
      getDocumentContextPath(databaseDocument),
    ]);
    return {
      database: serializeDatabase(
        { ...resolved.database, title: selected.title },
        selected.description,
      ),
      contextPath,
      properties,
    };
  },
});
