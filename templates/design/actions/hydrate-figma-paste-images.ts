/**
 * Retroactively resolve unresolved Figma image fills for a screen that was
 * imported via the local-kiwi clipboard path, using Figma's REST image
 * endpoint (requires a saved FIGMA_ACCESS_TOKEN).
 *
 * When a Figma paste is imported without an access token, IMAGE fills render as
 * `url("about:blank")` placeholders. The originating elements are annotated
 * with `data-figma-image-ref="hash1 hash2 …"` so this action can find them
 * without a full re-parse. Each Nth hash in the attribute maps to the Nth
 * `url(&quot;about:blank&quot;)` occurrence in the element's style attribute.
 *
 * The read → collect → resolve → persist pipeline lives in
 * `server/lib/figma-image-hydration.ts` and is shared with the token-free
 * `.fig` hydration path (see `hydrateFileImagesFromFig`). This action only
 * supplies the REST resolver.
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  applyHydration,
  collectImageRefHashes,
  hydrateImageRefsInHtml,
  loadHydratableFile,
} from "../server/lib/figma-image-hydration.js";
import { resolveImageFillRefs } from "../server/lib/figma-node-import.js";
import { readLiveSourceFile } from "../server/source-workspace.js";

// Re-exported for direct unit testing of the pure HTML helpers.
export { collectImageRefHashes, hydrateImageRefsInHtml };

export default defineAction({
  description:
    'Retroactively resolve unresolved Figma image fills for a screen imported via the no-token local-kiwi path (import-figma-clipboard returned strategy:"localKiwi"). Requires a saved FIGMA_ACCESS_TOKEN. Fetches CDN URLs from Figma\'s /files/:key/images endpoint, mirrors them to durable blob storage, and replaces every url("about:blank") placeholder stamped by the local-kiwi decoder with the real durable URL. Fully resolved elements have their data-figma-image-ref annotation removed; partially resolved elements retain it for a future retry. Returns resolved/missing/skipped counts. Call after connecting Figma in Settings to fill in images from a no-token paste. For a token-free path when the original .fig file is available, upload the .fig with hydrateFileIds via /api/import-design-file instead.',
  schema: z.object({
    fileId: z
      .string()
      .describe(
        "ID of the design_files row to hydrate. Use the fileId returned by import-figma-clipboard.",
      ),
  }),
  run: async ({ fileId }) => {
    const { workspaceFile, designId, figmaFileKey } =
      await loadHydratableFile(fileId);

    if (!figmaFileKey) {
      throw new Error(
        `No Figma file key found for file ${fileId}. This file may not have been imported via a Figma clipboard paste.`,
      );
    }

    const live = await readLiveSourceFile(workspaceFile);

    const hashesToResolve = collectImageRefHashes(live.content);
    if (hashesToResolve.length === 0) {
      return {
        fileId,
        resolved: 0,
        missing: 0,
        skipped: 0,
        message: "No unresolved image refs found in this file.",
      };
    }

    let resolvedUrls: Map<string, string>;
    try {
      resolvedUrls = await resolveImageFillRefs(figmaFileKey, hashesToResolve);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/quota cooldown|provider.*quota/i.test(msg)) {
        const retryAfterSeconds =
          (err as { retryAfterSeconds?: number }).retryAfterSeconds ?? 0;
        const waitHint =
          retryAfterSeconds > 0
            ? retryAfterSeconds >= 60
              ? `${Math.ceil(retryAfterSeconds / 60)} min`
              : `${retryAfterSeconds}s`
            : "~1 min";
        throw Object.assign(
          new Error(`Figma API rate limited — try again in ${waitHint}.`),
          { statusCode: 429 },
        );
      }
      throw err;
    }

    if (resolvedUrls.size === 0) {
      return {
        fileId,
        resolved: 0,
        missing: hashesToResolve.length,
        skipped: 0,
        message: `Figma returned no image URLs for ${hashesToResolve.length} hash${hashesToResolve.length === 1 ? "" : "es"}. The images may have been deleted from the Figma file or the access token lacks file_content:read scope.`,
      };
    }

    const result = await applyHydration({
      file: workspaceFile,
      designId,
      fileId,
      liveContent: live.content,
      liveVersionHash: live.versionHash,
      requestedHashes: hashesToResolve,
      resolvedUrls,
    });

    return {
      fileId,
      resolved: result.resolved,
      missing: result.missing,
      skipped: result.skipped,
    };
  },
});
