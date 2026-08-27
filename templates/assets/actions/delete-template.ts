import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { resolveTemplateAccess } from "./_template-access.js";

export default defineAction({
  description:
    "Delete an asset template when no handoff session references it.",
  schema: z.object({ id: z.string() }),
  run: async ({ id }) => {
    await resolveTemplateAccess(id, "editor");
    const db = getDb();
    const [session] = await db
      .select({ id: schema.assetGenerationSessions.id })
      .from(schema.assetGenerationSessions)
      .where(eq(schema.assetGenerationSessions.presetId, id))
      .limit(1);
    if (session)
      throw new Error(
        "Template is used by an existing handoff session and cannot be deleted.",
      );
    await db
      .delete(schema.assetTemplateShares)
      .where(eq(schema.assetTemplateShares.resourceId, id));
    await db
      .delete(schema.assetTemplates)
      .where(eq(schema.assetTemplates.id, id));
    return { id, deleted: true };
  },
});
