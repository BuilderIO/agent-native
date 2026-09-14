import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

import { adoptDocumentIntoDatabase } from "./_database-membership-adopt.js";
import { getContentDatabaseResponse } from "./_database-utils.js";

const schema = z
  .object({
    databaseId: z.string().optional().describe("Content collection ID"),
    databaseDocumentId: z
      .string()
      .optional()
      .describe("Content collection backing document ID"),
    documentId: z
      .string()
      .describe("ID of the existing page to move into the collection"),
  })
  .superRefine((value, ctx) => {
    if (!value.databaseId && !value.databaseDocumentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Either databaseId or databaseDocumentId is required.",
      });
    }
  });

export default defineAction({
  description:
    "Move an existing Content page into an existing collection so it becomes a real row. Use this instead of add-database-item whenever the page already exists — add-database-item creates a new blank page and never adopts one. Returns a receipt read back from storage, so a success means the membership is durable.",
  mcpTool: true,
  schema,
  audit: {
    target: (args: z.infer<typeof schema>) => ({
      type: "content-database",
      id: args.databaseId ?? args.databaseDocumentId!,
      visibility: "private" as const,
    }),
    summary: (args: z.infer<typeof schema>) =>
      `Added page ${args.documentId} to a Content collection`,
  },
  run: async (args: z.infer<typeof schema>) => {
    const receipt = await adoptDocumentIntoDatabase({
      databaseId: args.databaseId,
      databaseDocumentId: args.databaseDocumentId,
      documentId: args.documentId,
    });
    await writeAppState("refresh-signal", { ts: Date.now() });
    return {
      ...(await getContentDatabaseResponse(receipt.databaseId, {
        limit: 100,
        offset: 0,
      })),
      receipt,
    };
  },
});
