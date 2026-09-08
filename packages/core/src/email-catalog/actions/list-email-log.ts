import { z } from "zod";

import { defineAction } from "../../action.js";
import { getAppConfig } from "../../app-config/index.js";
import { getRequestOrgId } from "../../server/request-context.js";
import { authorizeTransactionalEmailRead } from "../authorize.js";
import { listEmailLog } from "../log.js";

export default defineAction({
  description:
    "List recent transactional email sends from this app, newest first, optionally filtered to one registered email id.",
  schema: z.object({
    templateId: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  }),
  http: { method: "GET" },
  authorize: ({ templateId }) =>
    authorizeTransactionalEmailRead(templateId ? [templateId] : []),
  run: async ({ templateId, limit }) => ({
    entries: await listEmailLog({
      orgId: getRequestOrgId() ?? "",
      app: getAppConfig().app.slug ?? "unknown",
      templateId,
      limit,
    }),
  }),
});
