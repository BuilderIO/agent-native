import { defineAction } from "@agent-native/core";
import { z } from "zod";

import type {
  ContentDatabaseDescriptionResponse,
  ContentDatabaseUnavailableResponse,
} from "../shared/api.js";
import {
  getContentDatabaseResponse,
  resolveContentDatabaseRead,
} from "./_database-utils.js";
import listContentDatabases from "./list-content-databases.js";

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
    } catch {
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

    const response = await getContentDatabaseResponse(resolved.database.id, {
      limit: 1,
      database: resolved.database,
    });
    return {
      database: response.database,
      contextPath: response.contextPath ?? [],
      properties: response.properties,
    };
  },
});
