import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { listErrorIssues } from "../server/lib/error-capture.js";

function resolveScope() {
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");
  return { userEmail, orgId: getRequestOrgId() || null };
}

export default defineAction({
  description:
    "List captured JavaScript error issues (Sentry-style groups) accessible to the current user/org. Each issue groups occurrences by fingerprint with counts, users affected, first/last seen, status, and a recent-volume sparkline.",
  schema: z.object({
    status: z
      .enum(["unresolved", "resolved", "ignored", "all"])
      .optional()
      .describe("Filter by triage status. Defaults to all."),
    query: z
      .string()
      .optional()
      .describe("Search across issue title, type, culprit, and fingerprint."),
    app: z.string().optional().describe("Optional app filter."),
    sessionRecordingId: z
      .string()
      .optional()
      .describe(
        "Filter to issues with an occurrence in this session recording.",
      ),
    userId: z
      .string()
      .optional()
      .describe(
        "Filter to issues with an occurrence for this user ID or user key.",
      ),
    sort: z
      .enum(["lastSeen", "eventCount", "firstSeen"])
      .optional()
      .describe("Sort order; defaults to most recently seen."),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async (args) => {
    return listErrorIssues(resolveScope(), args);
  },
});
