import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  emailLabelChangeOutputSchema,
  emailLabelChangeSchema,
  runEmailLabelChange,
  type EmailLabelChangeResult,
} from "../server/lib/email-label-change.js";
import { getAccessTokens } from "./helpers.js";

export type LabelEmailResult = EmailLabelChangeResult;

export default defineAction({
  description:
    "Add a Gmail label to one or more email threads and keep them where they are, Inbox included. The label must already exist; call create-label first for a new one. To file a thread out of Inbox, use move-email instead.",
  schema: z.object({
    ...emailLabelChangeSchema,
    id: z.string().optional().describe("Email ID(s) to label, comma-separated"),
    label: z.string().optional().describe("Label name or ID to add"),
  }),
  outputSchema: emailLabelChangeOutputSchema,
  mcpTool: "search",
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  run: async (args) =>
    runEmailLabelChange(args, {
      remove: [],
      errorCode: "label_failed",
      failMessage: "Could not label any requested emails",
      getAccounts: getAccessTokens,
    }),
});
