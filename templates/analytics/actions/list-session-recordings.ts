import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { listSessionRecordings } from "../server/lib/session-replay.js";

function resolveScope() {
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");
  return { userEmail, orgId: getRequestOrgId() || null };
}

export default defineAction({
  description:
    "List first-party Analytics session replay recordings accessible to the current user/org. Returns scoped recording summaries only, not raw replay chunks.",
  schema: z.object({
    query: z
      .string()
      .optional()
      .describe(
        "Optional broad search across recording, session, visitor, URL, app, and template fields",
      ),
    app: z.string().optional().describe("Optional app filter"),
    template: z.string().optional().describe("Optional template filter"),
    sessionId: z.string().optional().describe("Optional analytics session id"),
    userId: z.string().optional().describe("Optional signed-in user id"),
    anonymousId: z.string().optional().describe("Optional anonymous user id"),
    path: z.string().optional().describe("Optional exact path filter"),
    from: z
      .string()
      .optional()
      .describe("Inclusive started_at lower bound as an ISO timestamp"),
    to: z
      .string()
      .optional()
      .describe("Inclusive started_at upper bound as an ISO timestamp"),
    minDurationMs: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Only include recordings at least this long"),
    hasErrors: z.boolean().optional().describe("Only recordings with errors"),
    hasRageClicks: z
      .boolean()
      .optional()
      .describe("Only recordings with detected rage clicks"),
    status: z.enum(["active", "completed"]).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    return listSessionRecordings(resolveScope(), args);
  },
});
