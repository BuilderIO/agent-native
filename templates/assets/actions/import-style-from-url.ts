import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import {
  extractRenderedDesignSystemFromUrl,
  styleBriefFromRenderedDesign,
} from "@agent-native/creative-context/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { nowIso, parseJson, stringifyJson } from "../server/lib/json.js";
import type { StyleBrief } from "../shared/api.js";

/**
 * Render a public website once and merge its computed visual language into an
 * Assets library or collection style brief. This intentionally shares the
 * exact browser extractor used by Design and Slides instead of maintaining a
 * second image-only or static-HTML interpretation of the page.
 */
export default defineAction({
  description:
    "Render a website in a real browser and merge its design.md-style visual " +
    "language into an asset library or collection style brief. Captures " +
    "computed colors, typography, spacing, radii, shadows, components, CSS " +
    "variables, and logo references. Uses a static SSRF-safe fallback only " +
    "when browser rendering is unavailable.",
  schema: z.object({
    libraryId: z.string().describe("Asset library ID"),
    collectionId: z
      .string()
      .optional()
      .describe("Optional collection to update instead of the library"),
    url: z.string().describe("Public website URL to render and analyze"),
  }),
  run: async ({ libraryId, collectionId, url }) => {
    await assertAccess("asset-library", libraryId, "editor");
    const db = getDb();
    const [library] = await db
      .select()
      .from(schema.assetLibraries)
      .where(eq(schema.assetLibraries.id, libraryId))
      .limit(1);
    if (!library) throw new Error("Asset library not found.");

    const [collection] = collectionId
      ? await db
          .select()
          .from(schema.assetCollections)
          .where(eq(schema.assetCollections.id, collectionId))
          .limit(1)
      : [null];
    if (collectionId && !collection) throw new Error("Collection not found.");
    if (collection && collection.libraryId !== libraryId) {
      throw new Error("Collection does not belong to this asset library.");
    }

    const extraction = await extractRenderedDesignSystemFromUrl(url);
    if (extraction.status === "failed") {
      throw new Error(
        `Rendered website extraction failed: ${extraction.error ?? "unknown error"}`,
      );
    }

    const previous = parseJson<StyleBrief>(
      collection?.styleBrief ?? library.styleBrief,
      {},
    );
    const styleBrief = {
      ...previous,
      ...styleBriefFromRenderedDesign(extraction),
    } satisfies StyleBrief;
    const updatedAt = nowIso();

    if (collection) {
      await db
        .update(schema.assetCollections)
        .set({ styleBrief: stringifyJson(styleBrief), updatedAt })
        .where(eq(schema.assetCollections.id, collection.id));
    } else {
      const settings = parseJson<Record<string, unknown>>(library.settings, {});
      settings.brandAnalysis = {
        ...(typeof settings.brandAnalysis === "object" &&
        settings.brandAnalysis !== null
          ? settings.brandAnalysis
          : {}),
        analyzedAt: updatedAt,
        sourceUrl: extraction.finalUrl ?? extraction.url,
        mode: extraction.rendered ? "rendered-browser" : "static-fallback",
        method: extraction.method,
        status: extraction.status,
        warnings: extraction.warnings,
      };
      await db
        .update(schema.assetLibraries)
        .set({
          styleBrief: stringifyJson(styleBrief),
          settings: stringifyJson(settings),
          updatedAt,
        })
        .where(eq(schema.assetLibraries.id, libraryId));
    }

    return {
      libraryId,
      collectionId: collection?.id ?? null,
      status: extraction.status,
      rendered: extraction.rendered,
      sourceUrl: extraction.finalUrl ?? extraction.url,
      styleBrief,
      designMd: extraction.designMd,
      warnings: extraction.warnings,
      diagnostics: extraction.diagnostics,
    };
  },
});
