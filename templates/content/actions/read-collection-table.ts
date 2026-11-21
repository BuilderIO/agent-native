import { defineAction, fail } from "@agent-native/core/action";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  TABLE_COLLECTION_MAX_COLUMNS,
  TABLE_COLLECTION_MAX_ROWS,
} from "../shared/table-collection-seed.js";
import { buildCollectionExportProjection } from "./_collection-export.js";
import { contentDatabaseTableQuerySchema } from "./_database-utils.js";

export default defineAction({
  description:
    "Read the rows one view of a collection shows, as plain text: each row's title, then the given properties in order. Turning an inline collection into a table reads it.",
  schema: z.object({
    documentId: z.string().min(1).describe("Collection page ID"),
    viewId: z.string().min(1).describe("The view whose rows to read"),
    tableQuery: contentDatabaseTableQuerySchema.unwrap(),
    propertyIds: z
      .array(z.string().min(1))
      .max(TABLE_COLLECTION_MAX_COLUMNS - 1)
      .describe("Properties to read, in column order, after the title"),
  }),
  outputSchema: z.discriminatedUnion("fits", [
    z.object({
      fits: z.literal(true),
      properties: z.array(z.string()),
      rows: z.array(z.array(z.string())),
    }),
    z.object({ fits: z.literal(false), rowCount: z.number().int() }),
  ]),
  http: { method: "POST" },
  readOnly: true,
  agentTool: false,
  run: async ({ documentId, viewId, tableQuery, propertyIds }) => {
    if (!(await resolveAccess("document", documentId))) {
      fail(`Document "${documentId}" not found.`, { statusCode: 404 });
    }
    const projection = await buildCollectionExportProjection(documentId, {
      scope: { kind: "view_query", viewId, query: tableQuery },
      propertyIds,
      includePrimaryBody: false,
      blockPropertyIds: [],
    });
    if (projection.records.length > TABLE_COLLECTION_MAX_ROWS) {
      return { fits: false as const, rowCount: projection.records.length };
    }
    return {
      fits: true as const,
      properties: projection.scalarFields.map((field) => field.name),
      rows: projection.records.map((record) => [
        record.title,
        ...projection.scalarFields.map(
          (field) => record.scalarValues.get(field.id) ?? "",
        ),
      ]),
    };
  },
});
