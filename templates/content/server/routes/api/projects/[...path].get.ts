import { defineEventHandler, createError } from "h3";
import {
  getFileTree,
  getFile,
  getVersionHistory,
  getVersionContent,
} from "../../../handlers/projects.js";
import {
  listMedia,
  getChunkedMediaUploadStatus,
  serveChunkedMediaUploadSource,
  serveMedia,
} from "../../../handlers/media.js";
import { getResearch } from "../../../handlers/research.js";

/**
 * Catch-all GET handler for /api/projects/[...path]
 *
 * Parses the path to extract the project slug (which can span multiple segments)
 * and the action suffix, then delegates to the appropriate handler.
 */
export default defineEventHandler(async (event) => {
  const path = (event.context.params?.path as string) || "";
  const segments = path.split("/");

  // Match known suffixes and extract project from the remaining segments
  // Try longest suffix first

  // /api/projects/**:project/media/chunked/:uploadId/status
  const chunkedStatusIdx = findSuffix(segments, [
    "media",
    "chunked",
    null,
    "status",
  ]);
  if (chunkedStatusIdx >= 0) {
    setProjectParam(event, segments.slice(0, chunkedStatusIdx));
    event.context.params!.uploadId = segments[chunkedStatusIdx + 2];
    return getChunkedMediaUploadStatus(event);
  }

  // /api/projects/**:project/media/chunked/:uploadId/source
  const chunkedSourceIdx = findSuffix(segments, [
    "media",
    "chunked",
    null,
    "source",
  ]);
  if (chunkedSourceIdx >= 0) {
    setProjectParam(event, segments.slice(0, chunkedSourceIdx));
    event.context.params!.uploadId = segments[chunkedSourceIdx + 2];
    return serveChunkedMediaUploadSource(event);
  }

  // /api/projects/**:project/version-history/:versionId
  const vhVersionIdx = findSuffix(segments, ["version-history", null]);
  if (vhVersionIdx >= 0 && segments[vhVersionIdx + 1] !== undefined) {
    setProjectParam(event, segments.slice(0, vhVersionIdx));
    event.context.params!.versionId = segments[vhVersionIdx + 1];
    return getVersionContent(event);
  }

  // /api/projects/**:project/version-history
  const vhIdx = findSuffix(segments, ["version-history"]);
  if (vhIdx >= 0) {
    setProjectParam(event, segments.slice(0, vhIdx));
    return getVersionHistory(event);
  }

  // /api/projects/**:project/media/:filename
  const mediaFileIdx = findSuffix(segments, ["media", null]);
  if (mediaFileIdx >= 0 && segments[mediaFileIdx + 1] !== "chunked") {
    setProjectParam(event, segments.slice(0, mediaFileIdx));
    event.context.params!.filename = segments[mediaFileIdx + 1];
    return serveMedia(event);
  }

  // /api/projects/**:project/media
  const mediaIdx = findSuffix(segments, ["media"]);
  if (mediaIdx >= 0) {
    setProjectParam(event, segments.slice(0, mediaIdx));
    return listMedia(event);
  }

  // /api/projects/**:project/research
  const researchIdx = findSuffix(segments, ["research"]);
  if (researchIdx >= 0) {
    setProjectParam(event, segments.slice(0, researchIdx));
    return getResearch(event);
  }

  // /api/projects/**:project/tree
  const treeIdx = findSuffix(segments, ["tree"]);
  if (treeIdx >= 0) {
    setProjectParam(event, segments.slice(0, treeIdx));
    return getFileTree(event);
  }

  // /api/projects/**:project/file
  const fileIdx = findSuffix(segments, ["file"]);
  if (fileIdx >= 0) {
    setProjectParam(event, segments.slice(0, fileIdx));
    return getFile(event);
  }

  throw createError({ statusCode: 404, statusMessage: "Not found" });
});

function setProjectParam(event: any, projectSegments: string[]) {
  event.context.params = event.context.params || {};
  event.context.params.project = projectSegments.join("/");
}

/**
 * Find the index where a suffix pattern starts in the segments array.
 * `null` in the pattern matches any segment (wildcard).
 * Returns -1 if not found.
 */
function findSuffix(segments: string[], pattern: (string | null)[]): number {
  const start = segments.length - pattern.length;
  if (start < 0) return -1;

  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] !== null && segments[start + i] !== pattern[i]) {
      return -1;
    }
  }
  return start;
}
