import { defineAction } from "@agent-native/core";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { listAccessibleAudienceIds } from "../server/lib/audiences.js";
import { parseJson, serializeProposal } from "../server/lib/brain.js";

export default defineAction({
  description: "List Brain knowledge proposals requiring review.",
  schema: z.object({
    status: z
      .enum(["pending", "approved", "rejected", "quarantine"])
      .default("pending"),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ status, limit }) => {
    if (status === "quarantine") {
      const accessibleSources = await getDb()
        .select({ id: schema.brainSources.id })
        .from(schema.brainSources)
        .where(accessFilter(schema.brainSources, schema.brainSourceShares));
      const adminSourceIds = (
        await Promise.all(
          accessibleSources.map(async ({ id }) => {
            try {
              await assertAccess("brain-source", id, "admin");
              return id;
            } catch {
              return null;
            }
          }),
        )
      ).filter((sourceId): sourceId is string => Boolean(sourceId));
      if (!adminSourceIds.length) return { count: 0, proposals: [] };
      const rows = await getDb()
        .select({
          id: schema.brainSensitivityEvents.id,
          sourceId: schema.brainSensitivityEvents.sourceId,
          sourceName: schema.brainSources.title,
          disposition: schema.brainSensitivityEvents.disposition,
          categoriesJson: schema.brainSensitivityEvents.categoriesJson,
          confidenceBand: schema.brainSensitivityEvents.confidenceBand,
          expiresAt: schema.brainSensitivityEvents.expiresAt,
          createdAt: schema.brainSensitivityEvents.createdAt,
          updatedAt: schema.brainSensitivityEvents.updatedAt,
        })
        .from(schema.brainSensitivityEvents)
        .innerJoin(
          schema.brainSources,
          eq(schema.brainSources.id, schema.brainSensitivityEvents.sourceId),
        )
        .where(
          and(
            eq(schema.brainSensitivityEvents.disposition, "quarantined"),
            inArray(schema.brainSensitivityEvents.sourceId, adminSourceIds),
          ),
        )
        .orderBy(desc(schema.brainSensitivityEvents.createdAt))
        .limit(limit);
      const proposals = rows.map((row) => ({
        id: row.id,
        title: "Privacy quarantine",
        sourceId: row.sourceId,
        sourceName: row.sourceName,
        reason: [
          row.confidenceBand,
          ...parseJson<string[]>(row.categoriesJson, []),
          row.expiresAt ? `expires ${row.expiresAt}` : "metadata-only",
        ].join(" · "),
        status: "quarantine" as const,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));
      return { count: proposals.length, proposals };
    }
    const audienceIds = await listAccessibleAudienceIds();
    const rows = await getDb()
      .select()
      .from(schema.brainProposals)
      .where(
        and(
          accessFilter(schema.brainProposals, schema.brainProposalShares),
          or(
            isNull(schema.brainProposals.captureId),
            audienceIds.length
              ? and(
                  sql`exists (
                    select 1 from ${schema.brainSources}
                    where ${schema.brainSources.id} = ${schema.brainProposals.sourceId}
                      and ${accessFilter(schema.brainSources, schema.brainSourceShares)}
                  )`,
                  inArray(schema.brainProposals.audienceId, audienceIds),
                )
              : undefined,
          ),
          eq(schema.brainProposals.status, status),
        ),
      )
      .orderBy(desc(schema.brainProposals.createdAt))
      .limit(limit);
    return { count: rows.length, proposals: rows.map(serializeProposal) };
  },
});
