import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  emailLabelChangeOutputSchema,
  emailLabelChangeSchema,
  runEmailLabelChange,
  type EmailLabelChangeResult,
} from "../server/lib/email-label-change.js";
import { getAccessTokens } from "./helpers.js";

export type MoveEmailResult = EmailLabelChangeResult;

export default defineAction({
  description:
    "Move one or more email threads to a Gmail label/folder. Removes Inbox and the current label by default. To add a label and keep the thread in Inbox, use label-email instead.",
  schema: z.object({
    ...emailLabelChangeSchema,
    id: z.string().optional().describe("Email ID(s) to move, comma-separated"),
    label: z
      .string()
      .optional()
      .describe("Destination label/folder name or ID"),
    removeLabel: z
      .string()
      .optional()
      .describe("Current label to remove after applying the destination"),
  }),
  outputSchema: emailLabelChangeOutputSchema,
  mcpTool: "search",
  run: async (args) =>
    runEmailLabelChange(args, {
      remove: ["inbox", args.removeLabel ?? ""],
      errorCode: "move_failed",
      failMessage: "Could not move any requested emails",
      getAccounts: getAccessTokens,
    }),
});
