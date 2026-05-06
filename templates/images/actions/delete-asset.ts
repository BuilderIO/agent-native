import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { assertAccess } from "@agent-native/core/sharing";
import { getDb, schema } from "../server/db/index.js";
import { getAssetOrThrow } from "./_helpers.js";

export default defineAction({
  description:
    "Delete an image asset row. Requires editor access to its library.",
  schema: z.object({ id: z.string() }),
  run: async ({ id }) => {
    const asset = await getAssetOrThrow(id);
    await assertAccess("image-library", asset.libraryId, "editor");
    await getDb()
      .delete(schema.imageAssets)
      .where(eq(schema.imageAssets.id, id));
    return { id, deleted: true };
  },
});
