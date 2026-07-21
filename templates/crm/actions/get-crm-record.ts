import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getCrmRecord } from "../server/db/crm-store.js";

export default defineAction({
  description:
    "Return one access-scoped CRM record with bounded mirrored fields, recent interaction metadata, call-evidence references, and tasks. It never returns raw provider payloads, media, or transcripts.",
  schema: z.object({
    recordId: z.string().min(1).describe("Local CRM record ID."),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ recordId }) => {
    const record = await getCrmRecord(recordId);
    if (record) return record;
    const error = new Error("CRM record not found") as Error & {
      statusCode?: number;
    };
    error.statusCode = 404;
    throw error;
  },
});
