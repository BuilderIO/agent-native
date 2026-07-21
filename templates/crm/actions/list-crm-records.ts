import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listCrmRecords } from "../server/db/crm-store.js";

const kinds = [
  "account",
  "person",
  "opportunity",
  "activity",
  "task",
  "custom",
] as const;

export default defineAction({
  description:
    "List a bounded, access-scoped page of thinly mirrored CRM records. Use kind, connectionId, or a short display-name query to narrow the scope; remote-only and redacted fields are excluded.",
  schema: z.object({
    kind: z
      .enum(kinds)
      .optional()
      .describe("Optional canonical CRM record kind."),
    connectionId: z
      .string()
      .min(1)
      .optional()
      .describe("Optional CRM connection ID."),
    query: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe("Optional display-name search."),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z
      .string()
      .regex(/^\d+$/)
      .optional()
      .describe("Cursor returned by a previous page."),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: (input) => listCrmRecords(input),
});
