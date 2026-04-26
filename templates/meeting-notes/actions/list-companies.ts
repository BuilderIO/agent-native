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

    const conditions: any[] = [];
    if (orgId) {
      conditions.push(eq(schema.companies.organizationId, orgId));
    }

    if (args.search) {
      const pat = `%${args.search}%`;
      conditions.push(
        sql`(${schema.companies.name} LIKE ${pat} OR ${schema.companies.domain} LIKE ${pat})`,
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
