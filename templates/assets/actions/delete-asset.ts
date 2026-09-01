import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { assertCanDeleteAsset } from "../server/lib/library-access.js";
import { getAssetOrThrow } from "./_helpers.js";

export default defineAction({
  description:
    "Delete an asset row. Requires editor access to its library, except for an unsaved draft candidate, which its author can always discard.",
  schema: z.object({ id: z.string() }),
  run: async ({ id }) => {
    const asset = await getAssetOrThrow(id);
    await assertCanDeleteAsset(asset);
    await getDb().delete(schema.assets).where(eq(schema.assets.id, id));
    return { id, deleted: true };
  },
});
