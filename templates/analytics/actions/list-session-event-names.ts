import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { listSessionEventNames } from "../server/lib/session-event-index.js";
import { assertSessionsTriageLabEnabled } from "../server/lib/sessions-triage-lab.js";
import { sessionEventBoundSchema } from "../shared/session-events.js";

export default defineAction({
  description:
    "List event names tracked in Analytics sessions with the number of sessions that tracked each, for building did/didn't event filters on list-session-recordings. Reads Analytics' own session event index. Requires the Sessions triage Lab.",
  schema: z.object({
    from: sessionEventBoundSchema
      .optional()
      .describe(
        "Inclusive lower bound as an ISO date or a timestamp with an offset",
      ),
    to: sessionEventBoundSchema
      .optional()
      .describe(
        "Inclusive upper bound as an ISO date or a timestamp with an offset",
      ),
    app: z.string().optional().describe("Optional app filter"),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async (args) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      fail("no authenticated user", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }
    const orgId = getRequestOrgId() || null;
    await assertSessionsTriageLabEnabled(userEmail, orgId);
    return listSessionEventNames({ userEmail, orgId }, args);
  },
});
