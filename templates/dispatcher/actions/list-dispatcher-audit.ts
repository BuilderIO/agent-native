import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listAuditEvents } from "../server/lib/dispatcher-store.js";

export default defineAction({
  description: "List recent dispatcher audit events.",
  schema: z.object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
  }),
  http: { method: "GET" },
  run: async ({ limit }) => listAuditEvents(limit || 50),
});
