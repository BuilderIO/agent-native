import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { getErrorIssue } from "../server/lib/error-capture.js";

function resolveScope() {
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");
  return { userEmail, orgId: getRequestOrgId() || null };
}

export default defineAction({
  description:
    "Get one captured error issue with its recent occurrence frequency, parsed/raw stack traces, source code snippets when available, breadcrumbs, tags/extra, and links to the session replays where the error happened. Use this to triage a specific issue and jump to the replay.",
  schema: z.object({
    id: z.string().describe("Error issue id (erriss_...)."),
    eventsLimit: z.coerce
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe("Max recent occurrences to return. Defaults to 50."),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    return getErrorIssue(resolveScope(), args.id, {
      eventsLimit: args.eventsLimit,
    });
  },
});
