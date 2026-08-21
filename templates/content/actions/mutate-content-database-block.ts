import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { buildDeepLink } from "@agent-native/core/server";

import type { ContentDatabaseBlockMutationResult } from "../shared/database-block-actions.js";
import {
  mutateDatabaseBlock,
  mutateDatabaseBlockSchema,
} from "./_database-block-actions.js";

export default defineAction({
  description:
    "Insert, update, upsert, delete, or reorder one stable block in an exact Content database Blocks field. Requires schema, row, and field revisions; preserves siblings and returns an idempotent verified receipt.",
  schema: mutateDatabaseBlockSchema,
  audit: {
    recordInputs: false,
    target: (args) => ({
      type: "document",
      id: args.target.rowDocumentId,
      visibility: "private",
    }),
    summary: (_args, result) => {
      const receipt = (result as ContentDatabaseBlockMutationResult | null)
        ?.receipt;
      return receipt
        ? `${receipt.outcome === "unchanged" ? "Checked" : "Mutated"} Content database block field ${receipt.target.propertyId}`
        : "Mutated Content database block";
    },
  },
  run: async (args) => {
    const result = await mutateDatabaseBlock(args);
    await writeAppState("refresh-signal", { ts: Date.now() });
    return result;
  },
  link: ({ result }) => {
    const documentId = (result as ContentDatabaseBlockMutationResult | null)
      ?.receipt.target.rowDocumentId;
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
