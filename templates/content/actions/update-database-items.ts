import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema as dbSchema } from "../server/db/index.js";
import {
  isComputedPropertyType,
  type DocumentPropertyType,
} from "../shared/properties.js";
import { processWithConcurrency } from "./_batch-utils.js";
import {
  databaseRowBatchSchema,
  resolveDatabaseRowsForBatch,
} from "./_database-row-batch.js";
import setDocumentProperty from "./set-document-property.js";

const actionSchema = z.intersection(
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
  schema: actionSchema,
  run: async (args) => {
    const { database, rows } = await resolveDatabaseRowsForBatch(args);
    await assertAccess("document", database.documentId, "editor");

    // The property is the same for every row in this batch, so validate it
    // once here instead of letting all N per-row setDocumentProperty.run
    // calls independently repeat (and fail on) the identical check. The
    // per-row mutation itself still goes through setDocumentProperty.run,
    // one row at a time under bounded concurrency: each row needs its own
    // locked transaction (natural-key uniqueness is enforced per value, and
    // a row's own document can carry sharing different from the database's),
    // so a single blind bulk UPDATE would silently drop that per-row
    // correctness and the partial-success contract this action returns.
    const [definition] = await getDb()
      .select()
      .from(dbSchema.documentPropertyDefinitions)
      .where(eq(dbSchema.documentPropertyDefinitions.id, args.propertyId));
    if (!definition || definition.databaseId !== database.id) {
      throw new Error(`Property "${args.propertyId}" not found`);
    }
    if (definition.systemRole) {
      throw new Error("System properties are derived and cannot be edited.");
    }
    if (isComputedPropertyType(definition.type as DocumentPropertyType)) {
      throw new Error("Computed properties cannot be edited.");
    }

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
