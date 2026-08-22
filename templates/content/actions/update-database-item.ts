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
  updateDatabaseRow,
} from "./_database-row-mutation.js";

const schema = databaseMutationEnvelopeSchema.extend({
  itemId: z.string().min(1).describe("Exact database membership row ID"),
  documentId: z.string().min(1).describe("Exact row page ID"),
  expectedRowRevision: z
    .string()
    .min(1)
    .describe("Row revision returned by get-content-database"),
  title: z.string().trim().min(1).max(500).optional(),
  propertyValues: databasePropertyValuesSchema,
  propertyEntries: databasePropertyEntriesSchema.describe(
    "Sparse property patch as explicit entries; omitted fields are preserved and explicit null clears a value. Include one entry for every schema-valid writable property value the user requested, using the exact immutable property definition ID. When at least one value was requested, never pass an empty array. Do not invent or clear unmentioned properties.",
  ),
});

export default defineAction({
  description:
    "Sparsely update one exact Content database row by stable item and document IDs. Requires schema and row revisions, validates every non-Blocks property, and returns a verified idempotent receipt.",
  agentInputSchema: schema.omit({ propertyValues: true }),
  schema,
  http: { method: "PUT" },
  audit: {
    recordInputs: false,
    target: (args) => ({
      type: "document",
      id: args.documentId,
      visibility: "private",
    }),
    summary: (_args, result) => {
      const receipt = (result as ContentDatabaseRowMutationResult | null)
        ?.receipt;
      return receipt
        ? `${receipt.outcome === "unchanged" ? "Checked" : "Updated"} Content database row ${receipt.row.itemId}`
        : "Updated Content database row";
    },
  },
  run: (args) => updateDatabaseRow(canonicalizeDatabasePropertyInput(args)),
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
