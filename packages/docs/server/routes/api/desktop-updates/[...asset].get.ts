import {
  createError,
  defineEventHandler,
  getRouterParam,
  sendRedirect,
  setResponseHeaders,
  setResponseStatus,
} from "h3";

import {
  getDesktopDownloadManifest,
  getDesktopReleaseError,
  isDesktopUpdateMetadataAsset,
  isDesktopUpdaterAsset,
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

export default defineEventHandler(async (event) => {
  const assetName = safeAssetName(getRouterParam(event, "asset"));
  if (!isDesktopUpdaterAsset(assetName)) {
    throw createError({
      statusCode: 404,
      statusMessage: "Desktop update asset not found",
    });
  }

  let manifest;
  try {
    manifest = await getDesktopDownloadManifest();
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
    const upstream = await fetch(asset.url, {
      headers: { "user-agent": "agent-native-desktop-update-feed" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!upstream.ok) {
      throw createError({
        statusCode: 502,
        statusMessage: `Desktop update metadata fetch failed (${upstream.status})`,
      });
    }
    setResponseHeaders(event, {
      "content-type": "application/x-yaml; charset=utf-8",
      "cache-control": "public, max-age=60",
    });
    return upstream.text();
  }

  setResponseHeaders(event, {
    "cache-control": "public, max-age=300",
  });
  return sendRedirect(event, asset.url, 302);
});
