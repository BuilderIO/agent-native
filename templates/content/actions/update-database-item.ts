import { defineAction } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";

import type { ContentDatabaseRowMutationResult } from "../shared/api.js";
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
  propertyValues: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Sparse strict patch keyed by property definition ID; omitted fields are preserved and explicit null clears a value",
    ),
});

export default defineAction({
  description:
    "Sparsely update one exact Content database row by stable item and document IDs. Requires schema and row revisions, validates every non-Blocks property, and returns a verified idempotent receipt.",
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
  run: updateDatabaseRow,
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
