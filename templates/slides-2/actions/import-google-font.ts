import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { z } from "zod";

import { assertDeckAssetUploadScope } from "../server/lib/deck-asset-scope.js";
import {
  downloadGoogleFont,
  GoogleFontError,
} from "../server/lib/google-fonts.js";
import { isSlides2UploadStorageReady } from "../server/lib/upload-storage-status.js";
import {
  importGoogleFontAsset,
  UploadedFontError,
} from "../server/lib/uploaded-fonts.js";

function failTyped(error: unknown): never {
  if (
    error instanceof GoogleFontError ||
    error instanceof UploadedFontError ||
    (error instanceof Error &&
      typeof (error as { errorCode?: unknown }).errorCode === "string" &&
      typeof (error as { statusCode?: unknown }).statusCode === "number")
  ) {
    const typed = error as Error & { errorCode: string; statusCode: number };
    fail(typed.message, {
      errorCode: typed.errorCode,
      statusCode: typed.statusCode,
    });
  }
  fail("The selected Google Font could not be imported.", {
    errorCode: "google_font_import_failed",
    statusCode: 502,
  });
}

export default defineAction({
  title: "Import Google Font",
  description:
    "Download one catalog-verified Google Font family variant, validate and store its font binary, and return the registered asset handle. Apply the returned family and assetId through update-deck-design-tokens.",
  schema: z.object({
    deckId: z.string().min(1).max(200).describe("Deck to add the font to."),
    family: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .describe("Exact family returned by search-google-fonts."),
    variant: z
      .string()
      .trim()
      .min(1)
      .max(12)
      .describe("Exact available variant returned by search-google-fonts."),
  }),
  http: { method: "POST" },
  requiresAuth: true,
  retrySafe: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  run: async ({ deckId, family, variant }) => {
    const email = getRequestUserEmail();
    if (!email) {
      fail("Sign in to import fonts.", {
        errorCode: "google_font_auth_required",
        statusCode: 401,
      });
    }
    const orgId = getRequestOrgId();
    try {
      await assertDeckAssetUploadScope({ deckId, email, orgId });
    } catch (error) {
      failTyped(error);
    }
    if (!(await isSlides2UploadStorageReady())) {
      fail("Connect file storage before importing fonts.", {
        errorCode: "google_font_storage_unavailable",
        statusCode: 503,
      });
    }

    try {
      const downloaded = await downloadGoogleFont(family, variant);
      const asset = await importGoogleFontAsset({
        email,
        orgId,
        deckId,
        font: downloaded,
      });
      return {
        id: asset.assetId,
        assetId: asset.assetId,
        family: asset.family,
        variant: asset.variant,
        mimeType: asset.mimeType,
        url: asset.url,
        filename: asset.filename,
        size: asset.size,
        source: "google-fonts",
      };
    } catch (error) {
      failTyped(error);
    }
  },
});
