import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import type { ContentDatabaseRowPatchBatchResult } from "../shared/api.js";
import {
  databasePropertyEntriesSchema,
  databasePropertyValuesSchema,
} from "./_database-property-input.js";
import {
  DATABASE_ROW_PATCH_LIMIT,
  databaseMutationAgentTargetSchema,
  databaseMutationEnvelopeSchema,
  patchDatabaseRows,
} from "./_database-row-mutation.js";

const rowPatchSchema = z.object({
  itemId: z
    .string()
    .min(1)
    .describe(
      "Exact collection membership row ID from the item's id in the same fresh get-content-database read; never the row page document ID",
    ),
  documentId: z
    .string()
    .min(1)
    .describe(
      "Exact row page ID from the item's document.id in the same fresh get-content-database read; distinct from itemId",
    ),
  expectedRowRevision: z
    .string()
    .min(1)
    .describe("The item's rowRevision from the same get-content-database read"),
  title: z.string().trim().min(1).max(500).optional(),
  propertyValues: databasePropertyValuesSchema,
  propertyEntries: databasePropertyEntriesSchema.describe(
    "This row's sparse typed property patch; omitted fields are preserved and explicit null clears a value. Copy each propertyType from the discovered mutation contract and use the exact immutable property definition ID. Do not invent or clear unmentioned properties.",
  ),
});

const rowsDescription = `Rows to patch, each with its own values; 1 to ${DATABASE_ROW_PATCH_LIMIT} existing rows of this collection, each listed once. Include only rows whose requested values differ.`;

const schema = databaseMutationEnvelopeSchema.extend({
  rows: z
    .array(rowPatchSchema)
    .min(1)
    .max(DATABASE_ROW_PATCH_LIMIT)
    .describe(rowsDescription),
});
const agentSchema = schema
  .extend({
    target: databaseMutationAgentTargetSchema.strict(),
    rows: z
      .array(rowPatchSchema.omit({ propertyValues: true }).strict())
      .min(1)
      .max(DATABASE_ROW_PATCH_LIMIT)
      .describe(rowsDescription),
  })
  .strict();

export default defineAction({
  description: `Apply a different sparse patch to each of up to ${DATABASE_ROW_PATCH_LIMIT} existing rows of one Content collection in one atomic call, for example a distinct rank per row. Copy the target, schemaRevision, and every row's itemId, document.id, and rowRevision from one fresh get-content-database read. Either every row is written or none is: a stale row revision or invalid entry writes nothing and the error lists every affected row, so reread only those rows and resend. Retrying with the same idempotencyKey and payload replays the stored receipt. Returns one verified receipt per row with the patched values read back. Use update-database-item for a single row.`,
  mcpTool: true,
  mcpApp: { structuredContent: true },
  agentInputSchema: agentSchema,
  schema,
  audit: {
    recordInputs: false,
    target: (args) => ({
      type: "content-database",
      id: args.target.databaseId,
      visibility: "private",
    }),
    summary: (_args, result) => {
      const counts = (result as ContentDatabaseRowPatchBatchResult | null)
        ?.receipt.counts;
      return counts
        ? `Patched ${counts.updated} of ${counts.requested} Content collection rows`
        : "Patched Content collection rows";
    },
  },
  run: (args, context) => {
    if (context?.caller === "mcp") agentSchema.parse(args);
    return patchDatabaseRows(args);
  },
});
