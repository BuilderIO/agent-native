import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { assertAccess } from "@agent-native/core/sharing";
import { getDb, schema } from "../server/db/index.js";
import { extractDominantColors } from "../server/lib/image-processing.js";
import { getObject } from "../server/lib/storage.js";
import { nowIso, parseJson, stringifyJson } from "../server/lib/json.js";
import type { StyleBrief } from "../shared/api.js";

export default defineAction({
  description:
    "Extract dominant colors from reference images and write them into the library style brief palette.",
  schema: z.object({
    libraryId: z.string(),
  }),
  run: async ({ libraryId }) => {
    await assertAccess("image-library", libraryId, "editor");
    const db = getDb();
    const [library] = await db
      .select()
      .from(schema.imageLibraries)
      .where(eq(schema.imageLibraries.id, libraryId))
      .limit(1);
    if (!library) throw new Error("Image library not found.");
    const assets = await db
      .select()
      .from(schema.imageAssets)
      .where(eq(schema.imageAssets.libraryId, libraryId));
    const counts = new Map<string, number>();
    for (const asset of assets
      .filter((asset) => asset.status === "reference")
      .slice(0, 24)) {
      const buffer = await getObject(asset.objectKey).catch(() => null);
      if (!buffer) continue;
      for (const color of await extractDominantColors(buffer).catch(() => [])) {
        counts.set(color, (counts.get(color) ?? 0) + 1);
      }
    }
    const palette = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([color]) => color);
    const styleBrief = parseJson<StyleBrief>(library.styleBrief, {});
    styleBrief.palette = palette;
    await db
      .update(schema.imageLibraries)
      .set({ styleBrief: stringifyJson(styleBrief), updatedAt: nowIso() })
      .where(eq(schema.imageLibraries.id, libraryId));
    return { libraryId, palette };
  },
});
