import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { z } from "zod";

import { uploadImageAsset } from "../server/handlers/assets.js";
import { assertDeckAssetUploadScope } from "../server/lib/deck-asset-scope.js";
import { fetchSvglLogoSvg, SvglError } from "../server/lib/svgl.js";
import { isSlides2UploadStorageReady } from "../server/lib/upload-storage-status.js";

function svgFilename(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return `${slug || "svgl-logo"}.svg`;
}

export default defineAction({
  title: "Import SVGL logo",
  description:
    "Download one SVG route returned by search-svgl-logos and save it as a sanitized image asset. Pass deckId to save it to a deck; omit deckId for the global asset collection. Returns the registered asset id and URL.",
  schema: z.object({
    route: z
      .string()
      .max(2_048)
      .describe("The selected HTTPS SVG route returned by search-svgl-logos."),
    title: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe("The logo title returned by search-svgl-logos."),
    deckId: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        "Optional destination deck ID. Omit it to save the logo to the global asset collection.",
      ),
  }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  run: async ({ route, title, deckId }) => {
    const email = getRequestUserEmail();
    if (!email) {
      fail("Sign in to import a logo.", {
        errorCode: "svgl_import_auth_required",
        statusCode: 401,
      });
    }

    const orgId = getRequestOrgId();
    if (deckId) {
      await assertDeckAssetUploadScope({ deckId, email, orgId });
    }
    if (!(await isSlides2UploadStorageReady())) {
      fail("Connect file storage before importing logos.", {
        errorCode: "image_upload_storage_unavailable",
        statusCode: 503,
      });
    }

    let data: Buffer;
    try {
      data = await fetchSvglLogoSvg(route);
    } catch (error) {
      if (error instanceof SvglError) {
        fail(error.message, {
          errorCode: error.errorCode,
          statusCode: error.statusCode,
        });
      }
      fail("The SVGL logo could not be downloaded.", {
        errorCode: "svgl_download_failed",
        statusCode: 502,
      });
    }

    const asset = await uploadImageAsset({
      email,
      orgId,
      ...(deckId ? { deckId } : {}),
      originalName: svgFilename(title),
      data,
      type: "image/svg+xml",
    });
    if (!asset.id || !asset.url) {
      fail("The SVGL logo was uploaded without an asset handle.", {
        errorCode: "svgl_asset_registration_failed",
        statusCode: 500,
      });
    }

    return {
      id: asset.id,
      assetId: asset.id,
      url: asset.url,
      filename: asset.filename,
      type: asset.type,
      size: asset.size,
      source: "svgl",
      message: `Imported ${asset.filename} as asset://${asset.id}.`,
    };
  },
});
