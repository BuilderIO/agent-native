import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { isValidSlug } from "../shared/domain-contract.js";
import {
  firstRow,
  formsAccess,
  formsErrors,
  nowIso,
  requireForm,
} from "./_access.js";
import { requireDomain } from "./_domains.js";

export default defineAction({
  description:
    "Serve a form on a verified custom domain at /<slug>. A form has one slug per domain; mapping it again changes the slug. Only published forms are served.",
  schema: z.object({
    domainId: z.string().describe("Domain id"),
    formId: z.string().describe("Form id"),
    slug: z
      .string()
      .min(1)
      .max(64)
      .describe("Lower-case path segment: letters, digits and hyphens"),
  }),
  outputSchema: z.object({ id: z.string() }),
  errors: formsErrors,
  run: async ({ domainId, formId, slug }) => {
    const access = formsAccess();
    const domain = await requireDomain(access, domainId);
    await requireForm(access, formId);
    if (domain.status !== "verified")
      return formsErrors.noWrite("Verify the domain first.", "conflict", {
        statusCode: 409,
      });
    if (!isValidSlug(slug))
      return formsErrors.noWrite(
        "Use lower-case letters, digits and hyphens for the path.",
        "invalid_input",
        { statusCode: 400 },
      );
    const { domainForms } = schema;
    const db = getDb();
    const clash = firstRow(
      await db
        .select({ formId: domainForms.formId })
        .from(domainForms)
        .where(
          and(eq(domainForms.domainId, domainId), eq(domainForms.slug, slug)),
        )
        .limit(1),
    );
    if (clash && clash.formId !== formId)
      return formsErrors.noWrite("That path is already used.", "conflict", {
        statusCode: 409,
      });
    const id = crypto.randomUUID();
    await db
      .insert(domainForms)
      .values({
        id,
        orgId: access.orgId,
        domainId,
        formId,
        slug,
        createdAt: nowIso(),
      })
      .onConflictDoUpdate({
        target: [domainForms.domainId, domainForms.formId],
        set: { slug },
      });
    return { id };
  },
});
