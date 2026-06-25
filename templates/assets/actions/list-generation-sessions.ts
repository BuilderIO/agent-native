import { defineAction } from "@agent-native/core";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { GENERATION_SESSION_STATUSES } from "../shared/api.js";
import {
  buildAssetLineage,
  requireLibrary,
  serializeGenerationSession,
  serializeGenerationSessionItems,
} from "./_helpers.js";

export default defineAction({
  description:
    "List creative handoff sessions for an asset library. Sessions group candidates, feedback, presets, and the active image a designer can continue.",
  schema: z.object({
    libraryId: z.string(),
    status: z.enum(GENERATION_SESSION_STATUSES).optional(),
    limit: z.coerce.number().default(50),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ libraryId, status, limit }) => {
    await requireLibrary(libraryId);
    const filters = [eq(schema.assetGenerationSessions.libraryId, libraryId)];
    if (status) filters.push(eq(schema.assetGenerationSessions.status, status));
    const db = getDb();
    const sessions = await db
      .select()
      .from(schema.assetGenerationSessions)
      .where(and(...filters))
      .orderBy(desc(schema.assetGenerationSessions.updatedAt))
      .limit(Math.min(Math.max(limit, 1), 100));
    const sessionIds = sessions.map((session) => session.id);
    const items = sessionIds.length
      ? await db
          .select()
          .from(schema.assetGenerationSessionItems)
          .where(
            inArray(schema.assetGenerationSessionItems.sessionId, sessionIds),
          )
          .orderBy(
            asc(schema.assetGenerationSessionItems.sortOrder),
            asc(schema.assetGenerationSessionItems.createdAt),
          )
      : [];
    const itemAssetIds = [
      ...new Set(
        items
          .map((item) => item.assetId)
          .filter((assetId): assetId is string => Boolean(assetId)),
      ),
    ];
    const assetRows = itemAssetIds.length
      ? await db
          .select()
          .from(schema.assets)
          .where(inArray(schema.assets.id, itemAssetIds))
      : [];
    const lineageById = buildAssetLineage(assetRows);
    const itemsBySessionId = new Map<string, typeof items>();
    for (const item of items) {
      const sessionItems = itemsBySessionId.get(item.sessionId) ?? [];
      sessionItems.push(item);
      itemsBySessionId.set(item.sessionId, sessionItems);
    }
    return {
      count: sessions.length,
      sessions: sessions.map((session) =>
        serializeGenerationSession({
          ...session,
          items: serializeGenerationSessionItems(
            itemsBySessionId.get(session.id) ?? [],
            lineageById,
          ),
        }),
      ),
    };
  },
});
