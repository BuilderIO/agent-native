import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { processWithConcurrency } from "./_batch-utils.js";
import {
  databaseRowBatchSchema,
  resolveDatabaseRowsForBatch,
} from "./_database-row-batch.js";
import setDocumentProperty from "./set-document-property.js";

const schema = z.intersection(
  databaseRowBatchSchema,
  z.object({
    propertyId: z.string().min(1).describe("Property definition ID"),
    value: z.unknown().describe("Value to assign to every selected row"),
  }),
);

export default defineAction({
  description:
    "Set one Content database property on multiple selected rows in one action call. Returns a result for every requested row; use this instead of looping set-document-property from the UI or agent.",
  mcpTool: true,
  schema,
  run: async (args) => {
    const { database, rows } = await resolveDatabaseRowsForBatch(args);
    await assertAccess("document", database.documentId, "editor");
    const results: Array<{
      itemId: string;
      documentId: string;
      success: boolean;
      error?: string;
    }> = [];

    await processWithConcurrency(
      rows.map((row, index) => ({ row, index })),
      8,
      async ({ row, index }) => {
        try {
          await setDocumentProperty.run({
            documentId: row.document.id,
            databaseId: database.id,
            propertyId: args.propertyId,
            value: args.value,
          });
          results[index] = {
            itemId: row.item.id,
            documentId: row.document.id,
            success: true,
          };
        } catch (error) {
          results[index] = {
            itemId: row.item.id,
            documentId: row.document.id,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );

    const failed = results.filter((result) => !result.success).length;
    return {
      databaseId: database.id,
      propertyId: args.propertyId,
      updated: results.length - failed,
      failed,
      results,
    };
  },
});
