import {
  createError,
  defineEventHandler,
  getRouterParam,
  sendRedirect,
  setResponseHeaders,
  setResponseStatus,
} from "h3";

import {
  DESKTOP_RELEASE_CACHE_HEADERS,
  getDesktopDownloadManifest,
  getDesktopReleaseError,
  isDesktopUpdateMetadataAsset,
  isDesktopUpdaterAsset,
  type DesktopReleaseChannel,
} from "../../../../lib/desktop-releases";

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
  const request = parseUpdatePath(getRouterParam(event, "asset"));
  const assetName = safeAssetName(request.assetName);
  if (!isDesktopUpdaterAsset(assetName)) {
    throw createError({
      statusCode: 404,
      statusMessage: "Desktop update asset not found",
    });
  }

  let manifest;
  try {
    manifest = await getDesktopDownloadManifest(request.channel);
  } catch (error) {
    const e = getDesktopReleaseError(error);
    setResponseStatus(event, e.statusCode, e.statusMessage);
    setResponseHeaders(event, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=30",
    });
    return { error: e.statusMessage };
  }

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

  if (isDesktopUpdateMetadataAsset(asset.name)) {
    // Let the updater follow GitHub's signed asset redirect directly. Proxying
    // the YAML through the docs function adds a second fragile upstream fetch
    // to the update path and turns transient GitHub asset failures into a 502.
    setResponseHeaders(event, DESKTOP_RELEASE_CACHE_HEADERS);
    return sendRedirect(event, asset.url, 302);
  }

  setResponseHeaders(event, DESKTOP_RELEASE_CACHE_HEADERS);
  return sendRedirect(event, asset.url, 302);
});
