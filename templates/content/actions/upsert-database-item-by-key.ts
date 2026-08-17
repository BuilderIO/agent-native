import { defineAction } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";

import type { ContentDatabaseRowMutationResult } from "../shared/api.js";
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
  propertyValues: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Sparse strict values keyed by property definition ID"),
});

export default defineAction({
  description:
    "Create or sparsely update one Content database row by that database's explicitly configured natural key. Requires schema and row compare-and-swap revisions and returns a verified idempotent receipt.",
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
  run: upsertDatabaseRow,
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
