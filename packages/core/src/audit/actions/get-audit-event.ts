import { z } from "zod";

import { defineAction } from "../../action.js";
import { getAuditEventById } from "../store.js";

/**
 * Fetch a single audit event by id, including its redacted input payload.
 * Scoped to the caller's identity — returns null if they can't access it.
 */
export default defineAction({
  description:
    "Get one audit-log event by id, with its full redacted input payload. Returns null if you don't have access to it.",
  schema: z.object({
    id: z.string().describe("The audit event id."),
  }),
  http: { method: "GET" },
  run: async (args, ctx) => {
    const event = await getAuditEventById(args.id, {
      userEmail: ctx?.userEmail,
      orgId: ctx?.orgId ?? null,
    });
    return { event };
  },
});
