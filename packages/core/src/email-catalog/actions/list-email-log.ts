import { z } from "zod";

import { defineAction } from "../../action.js";
import { getAppConfig } from "../../app-config/index.js";
import { getRequestOrgId } from "../../server/request-context.js";
import { authorizeTransactionalEmailRead } from "../authorize.js";
import { listEmailLog } from "../log.js";

export default defineAction({
  description:
    "List recent transactional email sends from this app, newest first — the audit trail of every attempted send, including the raw request sent to the mail provider and its raw response. Supports filtering by registered email id, recipient/sender substring, status, provider, and a date range. Use this to answer 'did this email go out' or 'why did this email go to the wrong person'.",
  schema: z.object({
    templateId: z.string().optional(),
    to: z
      .string()
      .optional()
      .describe("Substring match against the recipient address."),
    from: z
      .string()
      .optional()
      .describe("Substring match against the resolved sender address."),
    status: z.enum(["sent", "failed"]).optional(),
    provider: z.string().optional(),
    sinceMs: z.coerce
      .number()
      .optional()
      .describe("Only sends at or after this Unix epoch (ms)."),
    untilMs: z.coerce
      .number()
      .optional()
      .describe("Only sends at or before this Unix epoch (ms)."),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    offset: z.coerce.number().int().min(0).default(0),
  }),
  http: { method: "GET" },
  authorize: ({ templateId }) =>
    authorizeTransactionalEmailRead(templateId ? [templateId] : []),
  run: async ({
    templateId,
    to,
    from,
    status,
    provider,
    sinceMs,
    untilMs,
    limit,
    offset,
  }) => ({
    entries: await listEmailLog({
      orgId: getRequestOrgId() ?? "",
      app: getAppConfig().app.slug ?? "unknown",
      templateId,
      to,
      from,
      status,
      provider,
      sinceMs,
      untilMs,
      limit,
      offset,
    }),
  }),
});
