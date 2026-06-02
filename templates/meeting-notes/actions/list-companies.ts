/**
 * List companies extracted from email domains.
 *
 * Usage:
 *   pnpm action list-companies
 *   pnpm action list-companies --search="acme"
 */

import { defineAction } from "@agent-native/core";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getActiveOrganizationId } from "../server/lib/meetings.js";

function escapeLike(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1");
}

export default defineAction({
  description:
    "List companies extracted from meeting attendee email domains. Supports search.",
  schema: z.object({
    search: z
      .string()
      .optional()
      .describe("Company name or domain substring match"),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    offset: z.coerce.number().int().min(0).default(0),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const orgId = await getActiveOrganizationId();

    // Companies are an org-scoped roster (no per-row owner). Without an
    // active org, there are no companies the caller can legitimately see --
    // returning everything would expose other tenants' rosters.
    if (!orgId) {
      return { companies: [] as Array<never> };
    }

    const conditions: any[] = [eq(schema.companies.organizationId, orgId)];

    if (args.search) {
      const pat = `%${escapeLike(args.search.toLowerCase())}%`;
      conditions.push(
        sql`(LOWER(${schema.companies.name}) LIKE ${pat} ESCAPE '\\' OR LOWER(${schema.companies.domain}) LIKE ${pat} ESCAPE '\\')`,
      );
    }

    const whereClause = conditions.length
      ? sql`${sql.join(conditions, sql` AND `)}`
      : undefined;

    const rows = await db
      .select()
      .from(schema.companies)
      .where(whereClause)
      .orderBy(asc(schema.companies.name))
      .limit(args.limit)
      .offset(args.offset);

    return {
      companies: rows.map((c) => ({
        id: c.id,
        name: c.name,
        domain: c.domain,
        logoUrl: c.logoUrl,
        createdAt: c.createdAt,
      })),
    };
  },
});
