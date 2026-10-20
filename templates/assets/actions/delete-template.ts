import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  accessibleTemplateFilter,
  resolveTemplateAccess,
} from "./_template-access.js";

export default defineAction({
  description:
    "Delete an asset template when no handoff session references it.",
  schema: z.object({ id: z.string() }),
  run: async ({ id }) => {
    await resolveTemplateAccess(id, "editor");
    const templateFilter = await accessibleTemplateFilter();
    const db = getDb();
    const [[session], [run]] = await Promise.all([
      db
        .select({ id: schema.assetGenerationSessions.id })
        .from(schema.assetGenerationSessions)
        .where(eq(schema.assetGenerationSessions.presetId, id))
        .limit(1),
      db
        .select({ id: schema.assetGenerationRuns.id })
        .from(schema.assetGenerationRuns)
        .where(eq(schema.assetGenerationRuns.presetId, id))
        .limit(1),
    ]);
    if (session || run) throw new Error("template-in-use");
    await db
      .delete(schema.assetTemplateShares)
      .where(eq(schema.assetTemplateShares.resourceId, id));
    // guard:allow-unscoped — resolveTemplateAccess requires editor access through the template or inherited Brand Kit ACL; the SQL filter repeats accessible-template scope before deletion.
    await db
      .delete(schema.assetTemplates)
      .where(and(eq(schema.assetTemplates.id, id), templateFilter));
    return { id, deleted: true };
  },
});
