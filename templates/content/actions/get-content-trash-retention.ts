import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { readContentTrashRetention } from "../server/lib/content-trash-retention.js";

export default defineAction({
  description:
    "Get how long Trash keeps Pages before deleting them permanently, and when automatic deletion begins.",
  schema: z.object({}),
  outputSchema: z.object({
    retentionDays: z.number().int().positive(),
    startedAt: z.string().nullable(),
    deletionsBeginAt: z.string().nullable(),
  }),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: false,
  run: async () => {
    if (!getRequestUserEmail())
      fail("Authentication required", {
        errorCode: "unauthorized",
        statusCode: 401,
      });
    return readContentTrashRetention();
  },
});
