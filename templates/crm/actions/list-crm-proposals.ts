import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listCrmProposals } from "../server/db/crm-store.js";

export default defineAction({
  description:
    "List bounded, access-scoped CRM mutation proposals and their review status. Proposal payloads are intentionally omitted from this list surface.",
  schema: z.object({
    recordId: z.string().min(1).optional(),
    status: z
      .enum([
        "pending",
        "executing",
        "approved",
        "applied",
        "rejected",
        "conflict",
        "failed",
      ])
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z
      .string()
      .regex(/^\d+$/)
      .optional()
      .describe("Cursor returned by a previous page."),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: (input) => listCrmProposals(input),
});
