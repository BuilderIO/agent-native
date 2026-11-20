import { and, eq } from "drizzle-orm";
import { defineEventHandler, getQuery, setResponseStatus } from "h3";

import { normalizeHost } from "../../../shared/domain-contract.js";
import { getDb, schema } from "../../db/index.js";

// Caddy's on_demand_tls `ask` hook: 200 issues a certificate, anything else refuses.
export default defineEventHandler(async (event) => {
  const { domain } = getQuery(event);
  const verified =
    typeof domain === "string" &&
    (
      await getDb()
        .select({ id: schema.domains.id })
        .from(schema.domains)
        .where(
          and(
            eq(schema.domains.host, normalizeHost(domain)),
            eq(schema.domains.status, "verified"),
          ),
        )
        .limit(1)
    ).length > 0;
  setResponseStatus(event, verified ? 200 : 404);
  return verified ? "ok" : "not allowed";
});
