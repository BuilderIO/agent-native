import { z } from "zod";

import { defineAction } from "../../action.js";
import { getAppConfig } from "../../app-config/index.js";
import { getRequestOrgId } from "../../server/request-context.js";
import { authorizeTransactionalEmailRead } from "../authorize.js";
import { listEmailLog } from "../log.js";

const templateIdListSchema = z.string().transform((value) =>
  value
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);

export default defineAction({
  description:
    "List recent transactional email sends from this app, newest first — the audit trail of every attempted send, including the raw request sent to the mail provider and its raw response. Does NOT include the sent HTML/text body — fetch that for one row with get-email-log-body once you have its id, since bodies are large and each list page can hold up to 500 rows. Supports exact registered email inclusion, comma-separated registered email exclusions, recipient/sender inclusion and exclusion substrings, status, provider, and a date range. Use this to answer 'did this email go out' or 'why did this email go to the wrong person'.",
  schema: z.object({
    templateId: z
      .string()
      .optional()
      .describe("Include only this exact registered transactional email ID."),
    excludeTemplateIds: templateIdListSchema
      .optional()
      .describe(
        "Exclude these registered transactional email IDs. For GET requests, provide a comma-separated string such as 'core.magic-link,core.organization-invite'.",
      ),
    to: z
      .string()
      .optional()
      .describe("Substring match against the recipient address."),
    excludeTo: z
      .string()
      .optional()
      .describe("Exclude recipient addresses containing this substring."),
    from: z
      .string()
      .optional()
      .describe("Substring match against the resolved sender address."),
    excludeFrom: z
      .string()
      .optional()
      .describe("Exclude resolved sender addresses containing this substring."),
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
    excludeTemplateIds,
    to,
    excludeTo,
    from,
    excludeFrom,
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
      excludeTemplateIds,
      to,
      excludeTo,
      from,
      excludeFrom,
      status,
      provider,
      sinceMs,
      untilMs,
      limit,
      offset,
    }),
  }),
});
