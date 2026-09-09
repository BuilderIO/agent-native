import { ActionContractError } from "@agent-native/core";
import { defineAction } from "@agent-native/core/action";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import type { ContentDatabaseSourceStatusResponse } from "../shared/api.js";
import {
  getContentDatabaseSourceSnapshot,
  resolveDatabaseForSourceMutation,
} from "./_database-source-utils.js";
import { getDatabaseById, serializeDatabase } from "./_property-utils.js";

const sourceStatusAgentSchema = z
  .object({
    statusOnly: z
      .literal(true)
      .default(true)
      .describe(
        "Return source status and mappings without row payloads or change-set details",
      ),
    databaseId: z
      .string()
      .min(1)
      .optional()
      .describe("Exact database ID from discovery"),
    documentId: z
      .string()
      .min(1)
      .optional()
      .describe("Exact backing Page ID from discovery"),
  })
  .strict()
  .refine(
    (args) => Boolean(args.databaseId) !== Boolean(args.documentId),
    "Provide exactly one databaseId or documentId",
  );

export default defineAction({
  description:
    "Get source-binding status for a content database, including local/no-source status, source metadata, field mappings, row identity, freshness, capabilities, and change sets.",
  mcpTool: true,
  agentInputSchema: sourceStatusAgentSchema,
  schema: z
    .object({
      statusOnly: z.boolean().optional(),
      databaseId: z.string().optional().describe("Database ID"),
      documentId: z.string().optional().describe("Database document/page ID"),
    })
    .strict(),
  http: { method: "GET" },
  readOnly: true,
  run: async (args, context): Promise<ContentDatabaseSourceStatusResponse> => {
    if (context?.caller === "mcp") sourceStatusAgentSchema.parse(args);
    const database = await resolveDatabaseForSourceMutation(args);
    if (!database)
      throw new ActionContractError("Database not found.", {
        errorCode: "DATABASE_NOT_FOUND",
        statusCode: 404,
      });

    const access = await resolveAccess("document", database.documentId);
    if (!access)
      throw new ActionContractError("Database not found.", {
        errorCode: "DATABASE_NOT_FOUND",
        statusCode: 404,
      });
    if (args.documentId && database.documentId !== args.documentId)
      throw new ActionContractError("Database and backing Page do not match.", {
        errorCode: "TARGET_MISMATCH",
        statusCode: 409,
      });

    const snapshot = await getContentDatabaseSourceSnapshot(database);
    if (snapshot?.sourceType === "local-table") {
      const sourceDatabase = await getDatabaseById(snapshot.sourceTable);
      if (
        !sourceDatabase ||
        !(await resolveAccess("document", sourceDatabase.documentId))
      ) {
        throw new ActionContractError(
          "The linked source is unavailable or inaccessible. This database is still source-backed.",
          { errorCode: "SOURCE_UNAVAILABLE", statusCode: 403 },
        );
      }
    }
    const source =
      snapshot && (args.statusOnly || context?.caller === "mcp")
        ? {
            ...snapshot,
            lastError: snapshot.lastError
              ? "Source reports an error; inspect its settings in Content."
              : null,
            metadata: {
              primaryKey: snapshot.metadata.primaryKey,
              titleField: snapshot.metadata.titleField,
              naturalKeyField: snapshot.metadata.naturalKeyField,
              writeMode: snapshot.metadata.writeMode,
              truthPolicy: snapshot.metadata.truthPolicy,
              syncPolicy: snapshot.metadata.syncPolicy,
            },
            rows: [],
            changeSets: [],
            projection: {
              rows: "omitted" as const,
              changeSets: "omitted" as const,
            },
          }
        : snapshot;
    return {
      database: serializeDatabase(database),
      mode: source ? "source-backed" : "local",
      summary: source
        ? `${source.sourceName} (${source.sourceType}) linked to ${source.sourceTable}; freshness ${source.freshness}.`
        : "Local / no source. This database has no external or mock source binding.",
      source,
    };
  },
});
