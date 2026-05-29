import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import {
  buildAssetLineage,
  getAssetOrThrow,
  serializeAsset,
} from "./_helpers.js";

export default defineAction({
  description:
    "Get a single DAM asset by ID with preview, download, and embed URLs.",
  schema: z.object({ id: z.string() }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ id }) => {
    const asset = await getAssetOrThrow(id);
    const libraryAssets = await getDb()
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.libraryId, asset.libraryId));
    const lineageById = buildAssetLineage(libraryAssets);
    return serializeAsset(asset, lineageById.get(asset.id) ?? null);
  },
});
