import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq, and, ne } from "drizzle-orm";
import { assertAccess } from "@agent-native/core/sharing";
import { getDb, schema } from "../server/db/index.js";
import { extractDominantColors } from "../server/lib/image-processing.js";
import { getObject } from "../server/lib/storage.js";
import { nowIso, parseJson, stringifyJson } from "../server/lib/json.js";
import { serializeLibrary } from "./_helpers.js";
import type { StyleBrief } from "../shared/api.js";

/**
 * Synthesize a reusable style guide from a library's reference images.
 *
 * Right now this extracts a dominant-color palette from each non-archived
 * reference asset (Sharp-based, no vision model), merges palettes by frequency,
 * and writes the result back to `library.styleBrief`. v2 will call a vision
 * model for descriptive style language; for v1 the dominant-color heuristic is
 * good enough to seed the palette field.
 */
export default defineAction({
  description:
    "Analyze the reference images in a library and update its style brief with an extracted palette. Use this after the user uploads reference images to seed the brand palette automatically.",
  schema: z.object({
    libraryId: z.string(),
    paletteSize: z.coerce.number().int().min(3).max(12).default(6),
  }),
  run: async ({ libraryId, paletteSize }) => {
    await assertAccess("image-library", libraryId, "editor");
    const db = getDb();
    const [library] = await db
      .select()
      .from(schema.imageLibraries)
      .where(eq(schema.imageLibraries.id, libraryId))
      .limit(1);
    if (!library) throw new Error("Image library not found.");

    // Pull every non-archived asset that isn't a generated candidate; these
    // are the brand evidence the agent should learn from.
    const refs = await db
      .select()
      .from(schema.imageAssets)
      .where(
        and(
          eq(schema.imageAssets.libraryId, libraryId),
          ne(schema.imageAssets.role, "generated"),
        ),
      );

    const colorScores = new Map<string, number>();
    for (const ref of refs) {
      const buffer = await getObject(ref.objectKey).catch(() => null);
      if (!buffer) continue;
      const colors = await extractDominantColors(buffer).catch(
        (): string[] => [],
      );
      colors.forEach((hex, idx) => {
        // Earlier colors in each ref's palette dominate; weight accordingly.
        const weight = colors.length - idx;
        colorScores.set(hex, (colorScores.get(hex) ?? 0) + weight);
      });
    }

    const palette = [...colorScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, paletteSize)
      .map(([hex]) => hex);

    const previous = parseJson<StyleBrief>(library.styleBrief, {});
    const styleBrief: StyleBrief = {
      ...previous,
      palette: palette.length > 0 ? palette : previous.palette,
    };

    await db
      .update(schema.imageLibraries)
      .set({ styleBrief: stringifyJson(styleBrief), updatedAt: nowIso() })
      .where(eq(schema.imageLibraries.id, libraryId));

    return {
      libraryId,
      analyzed: refs.length,
      palette,
      library: serializeLibrary({
        ...library,
        styleBrief: stringifyJson(styleBrief),
      }),
    };
  },
});
