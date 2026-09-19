import { z } from "zod";

import { defineAction } from "../../action.js";
import { getRequestOrgId } from "../../server/request-context.js";
import { authorizeTransactionalEmailRead } from "../authorize.js";
import { fetchEmailActivity } from "../provider-metrics.js";

export default defineAction({
  description:
    "List recent provider activity for one registered transactional email in this app. Organization admin only.",
  schema: z.object({
    templateId: z.string().min(1),
    limit: z.coerce.number().int().min(1).max(1000).default(50),
  }),
  http: { method: "GET" },
  authorize: ({ templateId }) => authorizeTransactionalEmailRead([templateId]),
  run: async ({ templateId, limit }) =>
    fetchEmailActivity({
      templateId,
      limit,
      orgId: getRequestOrgId(),
    }),
});
