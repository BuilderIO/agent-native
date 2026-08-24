import { defineEventHandler, getQuery, setResponseHeaders } from "h3";

import {
  DESKTOP_RELEASE_CACHE_HEADERS,
  type DesktopDownloadManifest,
  getDesktopDownloadManifest,
  getDesktopReleaseError,
} from "../../../lib/desktop-releases";
import { publicApiError } from "../../../lib/public-api-errors";

export default defineEventHandler(async (event) => {
  const channel =
    getQuery(event).channel === "nightly" ? "nightly" : "production";
  let manifest: DesktopDownloadManifest;
  try {
    manifest = await getDesktopDownloadManifest(channel);
  } catch (error) {
    const e = getDesktopReleaseError(error);
    return publicApiError(
      event,
      e.statusCode,
      {
        code: "desktop_release_unavailable",
        message: "Desktop release information is temporarily unavailable.",
        resolution:
          "Retry shortly. If the problem persists, check the Agent-Native release page.",
      },
      "public, max-age=30",
    );
  }

  setResponseHeaders(event, {
    "content-type": "application/json; charset=utf-8",
    ...DESKTOP_RELEASE_CACHE_HEADERS,
  });
  return manifest;
});
