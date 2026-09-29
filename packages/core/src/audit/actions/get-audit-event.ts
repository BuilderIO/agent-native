import { z } from "zod";

import { defineAction } from "../../action.js";
import { resolveAuditReadScope } from "../read-scope.js";
import { getAuditEventById } from "../store.js";

export default defineAction({
  description:
    "Get one audit-log event by id, with its full redacted input payload. Owners and admins can open any event in the organization audit log. Returns null if you don't have access to it.",
  schema: z.object({
    id: z.string().describe("The audit event id."),
  }),
  http: { method: "GET" },
  run: async (args, ctx) => {
    const event = await getAuditEventById(
      args.id,
      await resolveAuditReadScope(ctx),
    );
    return { event };
  },
});
