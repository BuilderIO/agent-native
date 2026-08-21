import { defineAction } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";

import type { ContentDatabaseRowMutationResult } from "../shared/api.js";
import {
  canonicalizeDatabasePropertyInput,
  databasePropertyEntriesSchema,
  databasePropertyValuesSchema,
} from "./_database-property-input.js";
import {
  databaseMutationEnvelopeSchema,
  upsertDatabaseRow,
} from "./_database-row-mutation.js";

const schema = databaseMutationEnvelopeSchema.extend({
  keyValue: z.string().min(1).describe("Value of the configured natural key"),
  expectedRowRevision: z
    .string()
    .min(1)
    .nullable()
    .describe(
      "Use null to assert the key is absent and create; use the discovered row revision to update an existing key",
    ),
  title: z.string().trim().min(1).max(500).optional(),
  propertyValues: databasePropertyValuesSchema,
  propertyEntries: databasePropertyEntriesSchema.describe(
    "Sparse property values as explicit entries. Include one entry for every schema-valid writable property value the user requested, using the exact immutable property definition ID. When at least one value was requested, never pass an empty array. Do not invent or clear unmentioned properties.",
  ),
});

export default defineAction({
  description:
    "Create or sparsely update one Content database row by that database's explicitly configured natural key. Requires schema and row compare-and-swap revisions and returns a verified idempotent receipt.",
  agentInputSchema: schema.omit({ propertyValues: true }),
  schema,
  audit: {
    recordInputs: false,
    target: (args) => ({
      type: "content-database",
      id: args.target.databaseId,
      visibility: "private",
    }),
    summary: (_args, result) => {
      const receipt = (result as ContentDatabaseRowMutationResult | null)
        ?.receipt;
      return receipt
        ? `${receipt.outcome === "created" ? "Created" : receipt.outcome === "updated" ? "Updated" : "Checked"} natural-key row ${receipt.row.itemId}`
        : "Upserted Content database row by natural key";
    },
  },
  run: (args) => upsertDatabaseRow(canonicalizeDatabasePropertyInput(args)),
  link: ({ result }) => {
    const documentId = (result as ContentDatabaseRowMutationResult | null)
      ?.receipt.row.documentId;
    if (!documentId) return null;
    return {
      url: buildDeepLink({
        app: "content",
        view: "editor",
        params: { documentId },
      }),
      label: "Open database row",
      view: "editor",
    };
  },
});
