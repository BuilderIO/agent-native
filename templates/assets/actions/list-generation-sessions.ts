import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { requireLibrary, serializeGenerationSession } from "./_helpers.js";
import { GENERATION_SESSION_STATUSES } from "../shared/api.js";

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
    const sessions = await getDb()
      .select()
      .from(schema.assetGenerationSessions)
      .where(and(...filters))
      .orderBy(desc(schema.assetGenerationSessions.updatedAt))
      .limit(Math.min(Math.max(limit, 1), 100));
    return {
      count: sessions.length,
      sessions: sessions.map(serializeGenerationSession),
    };
  },
});
