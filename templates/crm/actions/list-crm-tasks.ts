import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listCrmTasks } from "../server/db/crm-store.js";

export default defineAction({
  description:
    "List a bounded, access-scoped page of CRM follow-up tasks. Filter by the linked record or task status when needed.",
  schema: z.object({
    recordId: z.string().min(1).optional(),
    status: z.enum(["open", "done", "cancelled"]).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z
      .string()
      .regex(/^\d+$/)
      .optional()
      .describe("Cursor returned by a previous page."),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: (input) => listCrmTasks(input),
});
