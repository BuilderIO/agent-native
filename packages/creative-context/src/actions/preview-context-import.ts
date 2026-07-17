import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { stringArray } from "../connectors/provider-response.js";
import { smartDefaultExternalIds } from "../connectors/smart-defaults.js";
import { getCreativeContext } from "../server/context.js";
import { sanitizePublicMetadata } from "../server/public-serialization.js";
import { getContextSource } from "../store/index.js";

export default defineAction({
  description:
    "Preview source inventory metadata without fetching or returning item content.",
  schema: z.object({
    sourceId: z.string().min(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const source = await getContextSource(args.sourceId);
    if (!source) throw new Error("Context source not found or not accessible");
    const { connectors, connectorContext } = getCreativeContext();
    const page = await connectors.get(source.kind).inventory(
      {
        sourceId: source.id,
        config: {
          ...source.config,
          ...(source.connectionId ? { connectionId: source.connectionId } : {}),
        },
        cursor: args.cursor ?? null,
        limit: args.limit,
      },
      { ...connectorContext, ownerEmail: source.ownerEmail },
    );
    const items = page.items.map((item) => ({
      externalId: item.externalId,
      kind: item.kind,
      title: item.title,
      canonicalUrl: item.canonicalUrl,
      mimeType: item.mimeType,
      sourceModifiedAt: item.sourceModifiedAt,
      sizeBytes: item.sizeBytes,
      metadata: sanitizePublicMetadata(item.metadata),
      upstreamAccess: item.upstreamAccess,
    }));
    return {
      sourceId: source.id,
      items,
      smartDefaultExternalIds: smartDefaultExternalIds({
        kind: source.kind,
        items: page.items,
        canonicalExternalIds: stringArray(source.config.canonicalExternalIds),
        pinnedExternalIds: stringArray(source.config.pinnedExternalIds),
        now: connectorContext.now?.() ?? new Date(),
      }),
      nextCursor: page.nextCursor ?? undefined,
      total: page.complete ? page.coverage.inspected : undefined,
    };
  },
});
