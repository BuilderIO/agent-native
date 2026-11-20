import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  domainSchema,
  isValidHost,
  normalizeHost,
} from "../shared/domain-contract.js";
import { firstRow, formsAccess, formsErrors, nowIso } from "./_access.js";
import { toDomainRow } from "./_domains.js";

export default defineAction({
  description:
    "Add a custom domain such as forms.example.com. It starts pending; create the returned CNAME and TXT records, then call verify-domain.",
  schema: z.object({
    host: z
      .string()
      .min(1)
      .max(300)
      .describe("Domain host, e.g. forms.example.com"),
  }),
  outputSchema: domainSchema,
  errors: formsErrors,
  run: async ({ host: input }) => {
    const access = formsAccess();
    const host = normalizeHost(input);
    if (!isValidHost(host))
      return formsErrors.noWrite(
        "Enter a domain such as forms.example.com.",
        "invalid_input",
        {
          statusCode: 400,
        },
      );
    const { domains } = schema;
    const db = getDb();
    const taken = firstRow(
      await db
        .select({ id: domains.id })
        .from(domains)
        .where(eq(domains.host, host))
        .limit(1),
    );
    if (taken)
      return formsErrors.noWrite("That domain is already added.", "conflict", {
        statusCode: 409,
      });
    const row = {
      id: crypto.randomUUID(),
      orgId: access.orgId,
      createdBy: access.userEmail,
      host,
      verificationToken: crypto.randomUUID().replace(/-/g, ""),
      status: "pending",
      lastCheckedAt: null,
      verifiedAt: null,
      createdAt: nowIso(),
    };
    await db.insert(domains).values(row);
    return toDomainRow(row, []);
  },
});
