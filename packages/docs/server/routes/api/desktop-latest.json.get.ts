import { defineEventHandler, setResponseHeaders, setResponseStatus } from "h3";
import {
  type DesktopDownloadManifest,
  getDesktopDownloadManifest,
  getDesktopReleaseError,
} from "../../../lib/desktop-releases";

export default defineEventHandler(async (event) => {
  let manifest: DesktopDownloadManifest;
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

  setResponseHeaders(event, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=60",
  });
  return manifest;
});
