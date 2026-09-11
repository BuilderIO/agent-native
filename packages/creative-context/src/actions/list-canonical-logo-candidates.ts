import { defineAction } from "@agent-native/core/action";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, desc, eq, like, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import { creativeContextMediaUrl } from "../media-url.js";
import { getCreativeContext } from "../server/context.js";

export default defineAction({
  description:
    "Rank accessible exact-version logo candidates for human review; Figma vectors outrank website SVG/OG assets, which outrank deck rasters. This never sets a canonical logo.",
  schema: z.object({
    profileId: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async ({ profileId, limit }) => {
    if (profileId) {
      await assertAccess(
        "creative-context-brand",
        profileId,
        "viewer",
        undefined,
        { skipResourceBody: true },
      );
    }
    const { getDb, schema } = getCreativeContext();
    const rows = await getDb()
      .select({
        mediaId: schema.contextMedia.id,
        itemId: schema.contextItems.id,
        itemVersionId: schema.contextMedia.itemVersionId,
        title: schema.contextItems.title,
        itemKind: schema.contextItems.kind,
        sourceKind: schema.contextSources.kind,
        mimeType: schema.contextMedia.mimeType,
        metadata: schema.contextMedia.metadata,
        createdAt: schema.contextMedia.createdAt,
      })
      .from(schema.contextMedia)
      .innerJoin(
        schema.contextItems,
        eq(schema.contextItems.id, schema.contextMedia.itemId),
      )
      .innerJoin(
        schema.contextSources,
        eq(schema.contextSources.id, schema.contextItems.sourceId),
      )
      .where(
        and(
          accessFilter(schema.contextSources, schema.contextSourceShares),
          ne(schema.contextSources.status, "archived"),
          ne(schema.contextSources.upstreamAccess, "restricted"),
          eq(schema.contextItems.status, "active"),
          eq(schema.contextItems.curationStatus, "included"),
          eq(schema.contextMedia.kind, "image"),
          or(
            like(
              schema.contextMedia.metadata,
              '%"canonicalLogoCandidate":true%',
            ),
            like(schema.contextMedia.metadata, '%"assetRole":"open-graph"%'),
            sql`lower(${schema.contextItems.title}) like '%logo%'`,
            sql`lower(${schema.contextItems.title}) like '%wordmark%'`,
            sql`lower(${schema.contextItems.title}) like '%brandmark%'`,
          ),
          eq(
            schema.contextItems.currentVersionId,
            schema.contextMedia.itemVersionId,
          ),
        ),
      )
      .orderBy(desc(schema.contextMedia.createdAt))
      .limit(500);
    const candidates = rows
      .map((row: any) => {
        let metadata: Record<string, unknown> = {};
        try {
          metadata = JSON.parse(row.metadata || "{}");
        } catch {
          metadata = {};
        }
        const vector = row.mimeType === "image/svg+xml";
        const logoNamed = /logo|wordmark|brandmark/i.test(
          `${row.title} ${row.itemKind}`,
        );
        const connectorCandidate = metadata.canonicalLogoCandidate === true;
        const tier =
          row.sourceKind === "figma" && vector
            ? 3
            : row.sourceKind === "website" && vector
              ? 2
              : row.sourceKind === "website"
                ? 1.5
                : row.sourceKind === "google-slides"
                  ? 1
                  : 0.5;
        return {
          mediaId: row.mediaId,
          itemId: row.itemId,
          itemVersionId: row.itemVersionId,
          title: row.title,
          mimeType: row.mimeType,
          thumbnailUrl: creativeContextMediaUrl({ mediaId: row.mediaId }),
          score: tier + (connectorCandidate ? 1 : 0) + (logoNamed ? 0.4 : 0),
          evidence: {
            sourceKind: row.sourceKind,
            vector,
            logoNamed,
            connectorCandidate,
            rankingPolicy: "figma-vector > website-svg-og > deck-raster",
          },
        };
      })
      .sort((left: any, right: any) => right.score - left.score)
      .slice(0, limit);
    return { profileId: profileId ?? null, candidates };
  },
});
