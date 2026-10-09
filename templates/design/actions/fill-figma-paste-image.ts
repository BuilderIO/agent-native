import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { snapshotDesignBeforeAgentEdit } from "../server/lib/design-versions.js";
import {
  applyHydration,
  collectImageRefHashes,
  loadHydratableFile,
} from "../server/lib/figma-image-hydration.js";
import { readLiveSourceFile } from "../server/source-workspace.js";

// data: URLs are rejected so image bytes never land in the screen HTML row.
const RENDERABLE_URL_RE = /^(?:https?:\/\/|\/(?!\/))/i;

export default defineAction({
  description:
    "Fill a missing image left by a no-token Figma paste or .fig import with an image the user supplies. Missing images are elements stamped with data-figma-image-ref=\"<hash>\" over a url('about:blank') background placeholder; filling one keeps the layer's size, position, and Figma scale mode, and fills every element that shares the hash. Upload a local or pasted file with upload-image first and pass its url. Pass hash to pick the image; omit it only when the screen has exactly one missing image (otherwise the error lists the hashes). Use hydrate-figma-paste-images instead to fetch the original Figma images with a connected token.",
  schema: z.object({
    fileId: z
      .string()
      .describe("ID of the design_files row that holds the missing image."),
    imageUrl: z
      .string()
      .trim()
      .refine((url) => RENDERABLE_URL_RE.test(url), {
        message:
          "imageUrl must be an http(s) URL or an app-relative path. Upload local files with upload-image first.",
      })
      .describe("Image to use, e.g. the url returned by upload-image."),
    hash: z
      .string()
      .optional()
      .describe(
        "The data-figma-image-ref hash to fill. Required when the screen has more than one missing image.",
      ),
  }),
  run: async ({ fileId, imageUrl, hash }, context) => {
    const { workspaceFile, designId } = await loadHydratableFile(fileId);
    const live = await readLiveSourceFile(workspaceFile);
    const missing = collectImageRefHashes(live.content);

    if (missing.length === 0) {
      fail("This screen has no missing images left to fill.", {
        errorCode: "no_missing_images",
        statusCode: 409,
      });
    }
    const target = hash ?? (missing.length === 1 ? missing[0] : undefined);
    if (!target) {
      fail(
        `This screen has ${missing.length} missing images. Pass hash as one of: ${missing.join(", ")}.`,
        { errorCode: "hash_required", details: { hashes: missing } },
      );
    }
    if (!missing.includes(target)) {
      fail(`No missing image with hash ${target} on this screen.`, {
        errorCode: "not_found",
        statusCode: 404,
        details: { hashes: missing },
      });
    }

    await snapshotDesignBeforeAgentEdit(designId, context);
    const result = await applyHydration({
      file: workspaceFile,
      designId,
      fileId,
      liveContent: live.content,
      liveVersionHash: live.versionHash,
      requestedHashes: [target],
      resolvedUrls: new Map([[target, imageUrl]]),
    });
    if (result.resolved === 0) {
      fail(
        "The placeholder for this image was edited, so nothing was filled. Set the layer's image fill directly instead.",
        { errorCode: "placeholder_changed", statusCode: 409 },
      );
    }

    return {
      fileId,
      hash: target,
      resolved: result.resolved,
      missing: result.missing,
    };
  },
});
