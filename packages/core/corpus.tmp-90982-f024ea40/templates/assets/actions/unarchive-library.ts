import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { nowIso } from "../server/lib/json.js";
import { serializeLibrary } from "./_helpers.js";

export default defineAction({
  description:
    "Restore an archived asset library to the main library list. Requires admin access.",
  schema: z.object({ id: z.string() }),
  run: async ({ id }) => {
    await assertAccess("asset-library", id, "admin");
    const db = getDb();
    const now = nowIso();
    await db
      .update(schema.assetLibraries)
      .set({ archivedAt: null, updatedAt: now })
      .where(eq(schema.assetLibraries.id, id));
    const [library] = await db
      .select()
      .from(schema.assetLibraries)
      .where(eq(schema.assetLibraries.id, id))
      .limit(1);
    return {
      id,
      archived: false,
      library: library ? serializeLibrary(library) : null,
    };
  },
});
