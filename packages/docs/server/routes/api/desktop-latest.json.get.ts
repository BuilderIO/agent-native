import {
  defineEventHandler,
  getQuery,
  setResponseHeaders,
  setResponseStatus,
} from "h3";

import {
  DESKTOP_RELEASE_CACHE_HEADERS,
  type DesktopDownloadManifest,
  getDesktopDownloadManifest,
  getDesktopReleaseError,
} from "../../../lib/desktop-releases";

export default defineEventHandler(async (event) => {
  const channel =
    getQuery(event).channel === "nightly" ? "nightly" : "production";
  let manifest: DesktopDownloadManifest;
  try {
    manifest = await getDesktopDownloadManifest(channel);
  } catch (error) {
    const e = getDesktopReleaseError(error);
    setResponseStatus(event, e.statusCode, e.statusMessage);
    setResponseHeaders(event, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=30",
    });
    return { error: e.statusMessage };
  }

  setResponseHeaders(event, {
    "content-type": "application/json; charset=utf-8",
    ...DESKTOP_RELEASE_CACHE_HEADERS,
  });
  return manifest;
});
