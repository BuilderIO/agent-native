import {
  createError,
  defineEventHandler,
  getRouterParam,
  sendRedirect,
  setResponseHeaders,
} from "h3";

import {
  DESKTOP_RELEASE_CACHE_HEADERS,
  getDesktopDownloadManifest,
  getDesktopReleaseError,
  isDesktopUpdaterAsset,
  type DesktopReleaseChannel,
} from "../../../../lib/desktop-releases";
import { publicApiError } from "../../../../lib/public-api-errors";

function safeAssetName(value: string | undefined): string {
  const asset = value?.trim() ?? "";
  if (
    !asset ||
    asset.includes("/") ||
    asset.includes("\\") ||
    !/^[A-Za-z0-9._ -]+$/.test(asset)
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid desktop update asset",
    });
  }
  return asset;
}

function assetNameCandidates(assetName: string): string[] {
  const candidates = [assetName];
  if (/^Agent-Native-.+-mac\.zip\.blockmap$/i.test(assetName)) {
    candidates.push(assetName.replace(/^Agent-Native-/i, "Agent.Native-"));
  }
  return candidates;
}

function parseUpdatePath(value: string | undefined): {
  channel: DesktopReleaseChannel;
  assetName: string;
} {
  const segments = (value ?? "").split("/");
  if (segments[0] === "nightly") {
    return { channel: "nightly", assetName: segments.slice(1).join("/") };
  }
  return { channel: "production", assetName: value ?? "" };
}

export default defineEventHandler(async (event) => {
  try {
    const request = parseUpdatePath(getRouterParam(event, "asset"));
    const assetName = safeAssetName(request.assetName);
    if (!isDesktopUpdaterAsset(assetName)) {
      throw createError({
        statusCode: 404,
        statusMessage: "Desktop update asset not found",
      });
    }

    const manifest = await getDesktopDownloadManifest(request.channel);
    const candidateNames = assetNameCandidates(assetName);
    const asset = manifest.assets.find((item) =>
      candidateNames.includes(item.name),
    );
    if (!asset) {
      throw createError({
        statusCode: 404,
        statusMessage: "Desktop update asset not found",
      });
    }

    setResponseHeaders(event, DESKTOP_RELEASE_CACHE_HEADERS);
    return sendRedirect(event, asset.url, 302);
  } catch (error) {
    const e = getDesktopReleaseError(error);
    const statusCode = e.statusCode;
    const isClientError = statusCode === 400 || statusCode === 404;
    return publicApiError(
      event,
      statusCode,
      {
        code:
          statusCode === 400
            ? "invalid_desktop_update_asset"
            : statusCode === 404
              ? "desktop_update_asset_not_found"
              : "desktop_release_unavailable",
        message: isClientError
          ? e.statusMessage
          : "Desktop release information is temporarily unavailable.",
        resolution: isClientError
          ? "Use a supported updater asset from the OpenAPI specification."
          : "Retry shortly. If the problem persists, check the Agent-Native release page.",
      },
      isClientError ? "no-store" : "public, max-age=30",
    );
  }
});
