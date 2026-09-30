import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import {
  listSessionRecordings,
  listSessionRecordingsPage,
} from "../server/lib/session-replay.js";

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
    userId: z.string().optional().describe("Optional signed-in user email"),
    anonymousId: z
      .string()
      .optional()
      .describe(
        "Optional secondary anonymous id filter for otherwise email-backed recordings",
      ),
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
    hasNetworkErrors: z
      .boolean()
      .optional()
      .describe("Only recordings with failed network requests"),
    hideEmpty: z
      .boolean()
      .optional()
      .describe("Exclude recordings with zero duration"),
    hideInternal: z
      .boolean()
      .optional()
      .describe("Exclude visitors using the organization's email domains"),
    visitorType: z.enum(["internal", "work", "personal"]).optional(),
    emailDomain: z
      .string()
      .optional()
      .describe("Exact visitor email domain, without @"),
    sort: z.enum(["newest", "longest", "errors", "events", "rage"]).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    paginated: z
      .boolean()
      .optional()
      .describe(
        "Return recordings, total count, and app counts rather than the legacy recordings array",
      ),
    status: z.enum(["active", "completed"]).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  grounding: true,
  run: async (args) => {
    const scope = resolveScope();
    return args.paginated
      ? listSessionRecordingsPage(scope, args)
      : listSessionRecordings(scope, args);
  },
});
