import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { normalizeHost } from "../shared/domain-contract.js";
import { formsErrors } from "./_access.js";

export default defineAction({
  description:
    "Find the form a verified custom domain serves at a path, for the respondent page on that domain; no sign-in needed. Pending, unknown or unmapped paths return no form.",
  schema: z.object({
    host: z.string().min(1).max(300).describe("Host the visitor is on"),
    slug: z.string().min(1).max(64).describe("First path segment"),
  }),
  outputSchema: z.object({ formId: z.string().nullable() }),
  errors: formsErrors,
  requiresAuth: false,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ host, slug }) => {
    const { domains, domainForms } = schema;
    const rows = await getDb()
      .select({ formId: domainForms.formId })
      .from(domainForms)
      .innerJoin(domains, eq(domains.id, domainForms.domainId))
      .where(
        and(
          eq(domains.host, normalizeHost(host)),
          eq(domains.status, "verified"),
          eq(domainForms.slug, slug),
        ),
      )
      .limit(1);
    return { formId: rows[0]?.formId ?? null };
  },
});
