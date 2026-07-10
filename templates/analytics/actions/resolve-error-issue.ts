import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { updateErrorIssue } from "../server/lib/error-capture.js";

function resolveScope() {
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");
  return { userEmail, orgId: getRequestOrgId() || null };
}

export default defineAction({
  description:
    "Update the triage state of a captured error issue: set status to unresolved (reopen), resolved, or ignored, and optionally (re)assign a triage owner.",
  schema: z.object({
    id: z.string().describe("Error issue id (erriss_...)."),
    status: z
      .enum(["unresolved", "resolved", "ignored"])
      .optional()
      .describe("New triage status."),
    assignee: z
      .string()
      .nullable()
      .optional()
      .describe("Assignee email, or null to clear the assignment."),
  }),
  http: { method: "POST" },
  run: async (args) => {
    return updateErrorIssue(resolveScope(), args.id, {
      status: args.status,
      assignee: args.assignee,
    });
  },
});
