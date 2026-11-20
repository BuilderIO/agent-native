import { defineAction } from "@agent-native/core/action";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { domainSchema } from "../shared/domain-contract.js";
import { formsAccess, formsErrors, orgScope } from "./_access.js";
import { toDomainRow } from "./_domains.js";

export default defineAction({
  description:
    "List the organization's custom domains with the DNS records to create, their status, and the published forms each serves.",
  schema: z.object({}),
  outputSchema: z.object({ domains: z.array(domainSchema) }),
  errors: formsErrors,
  http: { method: "GET" },
  run: async () => {
    const access = formsAccess();
    const db = getDb();
    const { domains, domainForms, forms } = schema;
    const rows = await db
      .select()
      .from(domains)
      .where(orgScope(domains, access.orgId))
      .orderBy(asc(domains.createdAt))
      .limit(100);
    const mapped = await db
      .select({
        id: domainForms.id,
        domainId: domainForms.domainId,
        formId: domainForms.formId,
        formName: forms.name,
        slug: domainForms.slug,
      })
      .from(domainForms)
      .innerJoin(forms, eq(forms.id, domainForms.formId))
      .where(orgScope(domainForms, access.orgId))
      .orderBy(asc(domainForms.slug))
      .limit(1000);
    return {
      domains: rows.map((row) =>
        toDomainRow(
          row,
          mapped.filter((entry) => entry.domainId === row.id),
        ),
      ),
    };
  },
});
