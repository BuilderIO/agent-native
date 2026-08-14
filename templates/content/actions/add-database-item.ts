import { defineAction } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";

import type { ContentDatabaseRowMutationResult } from "../shared/api.js";
import {
  createDatabaseRow,
  databaseMutationEnvelopeSchema,
} from "./_database-row-mutation.js";
import { getContentDatabaseResponse } from "./_database-utils.js";

const schema = databaseMutationEnvelopeSchema.extend({
  title: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .optional()
    .describe("New row page title"),
  propertyValues: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Strict property values keyed by property definition ID"),
});

export default defineAction({
  description:
    "Create one row in an exact ordinary Content database using its discovered schema revision. Strictly validates every non-Blocks property, applies the side effect once per idempotency key, and returns a verified receipt with stable row identity.",
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
    title: "Add Content Database Item",
    description:
      "Delegate creation of one page item in an existing Content database.",
  },
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
        ? `Created Content database row ${receipt.row.itemId}`
        : "Created Content database row";
    },
  },
  run: async (args): Promise<ContentDatabaseRowMutationResult> => {
    const result = await createDatabaseRow(args);
    const response = await getContentDatabaseResponse(
      result.receipt.target.databaseId,
      {
        limit: 1,
        offset: 0,
        documentIds: [result.receipt.row.documentId],
      },
    );
    const createdItem = response.items[0];
    if (!createdItem || createdItem.id !== result.receipt.row.itemId) {
      throw new Error(
        "Created row receipt did not resolve to its exact read-back.",
      );
    }
    return { ...result, createdItem };
  },
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
