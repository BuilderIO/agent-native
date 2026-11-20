import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { domainSchema } from "../shared/domain-contract.js";
import { formsAccess, formsErrors, nowIso } from "./_access.js";
import { lookupVerification, requireDomain, toDomainRow } from "./_domains.js";

export default defineAction({
  description:
    "Check a domain's verification TXT record in DNS. The domain becomes verified only when the record is found; otherwise it stays pending and the result says whether the record was missing or the lookup failed.",
  schema: z.object({ id: z.string().describe("Domain id") }),
  outputSchema: z.object({
    domain: domainSchema,
    check: z.enum(["found", "no_record", "lookup_failed"]),
  }),
  errors: formsErrors,
  run: async ({ id }) => {
    const access = formsAccess();
    const row = await requireDomain(access, id);
    const result = await lookupVerification(row.host, row.verificationToken);
    const now = nowIso();
    const next = {
      ...row,
      lastCheckedAt: now,
      ...(result.found ? { status: "verified", verifiedAt: now } : {}),
    };
    await getDb()
      .update(schema.domains)
      .set({
        lastCheckedAt: next.lastCheckedAt,
        status: next.status,
        verifiedAt: next.verifiedAt,
      })
      .where(eq(schema.domains.id, id));
    return {
      domain: toDomainRow(next, []),
      check: result.found ? ("found" as const) : result.reason,
    };
  },
});
