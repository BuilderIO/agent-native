import { defineEventHandler, createError } from "h3";
import { createFile } from "../../../handlers/projects.js";
import {
  uploadMedia,
  initializeChunkedMediaUpload,
  appendChunkedMediaUpload,
  completeChunkedMediaUpload,
  bulkDeleteMedia,
} from "../../../handlers/media.js";
import { restoreVersion } from "../../../handlers/projects.js";

export default defineEventHandler(async (event) => {
  const path = (event.context.params?.path as string) || "";
  const segments = path.split("/");

  // /api/projects/**:project/media/chunked/:uploadId/chunk
  const chunkedChunkIdx = findSuffix(segments, ["media", "chunked", null, "chunk"]);
  if (chunkedChunkIdx >= 0) {
    setProjectParam(event, segments.slice(0, chunkedChunkIdx));
    event.context.params!.uploadId = segments[chunkedChunkIdx + 2];
    return appendChunkedMediaUpload(event);
  }

  // /api/projects/**:project/media/chunked/:uploadId/complete
  const chunkedCompleteIdx = findSuffix(segments, ["media", "chunked", null, "complete"]);
  if (chunkedCompleteIdx >= 0) {
    setProjectParam(event, segments.slice(0, chunkedCompleteIdx));
    event.context.params!.uploadId = segments[chunkedCompleteIdx + 2];
    return completeChunkedMediaUpload(event);
  }

  // /api/projects/**:project/media/chunked/init
  const chunkedInitIdx = findSuffix(segments, ["media", "chunked", "init"]);
  if (chunkedInitIdx >= 0) {
    setProjectParam(event, segments.slice(0, chunkedInitIdx));
    return initializeChunkedMediaUpload(event);
  }

  // /api/projects/**:project/media/bulk-delete
  const bulkDeleteIdx = findSuffix(segments, ["media", "bulk-delete"]);
  if (bulkDeleteIdx >= 0) {
    setProjectParam(event, segments.slice(0, bulkDeleteIdx));
    return bulkDeleteMedia(event);
  }

  // /api/projects/**:project/media
  const mediaIdx = findSuffix(segments, ["media"]);
  if (mediaIdx >= 0) {
    setProjectParam(event, segments.slice(0, mediaIdx));
    return uploadMedia(event);
  }

  // /api/projects/**:project/restore-version
  const restoreIdx = findSuffix(segments, ["restore-version"]);
  if (restoreIdx >= 0) {
    setProjectParam(event, segments.slice(0, restoreIdx));
    return restoreVersion(event);
  }

  // /api/projects/**:project/file
  const fileIdx = findSuffix(segments, ["file"]);
  if (fileIdx >= 0) {
    setProjectParam(event, segments.slice(0, fileIdx));
    return createFile(event);
  }

  throw createError({ statusCode: 404, statusMessage: "Not found" });
});

function setProjectParam(event: any, projectSegments: string[]) {
  event.context.params = event.context.params || {};
  event.context.params.project = projectSegments.join("/");
}

function findSuffix(segments: string[], pattern: (string | null)[]): number {
  const start = segments.length - pattern.length;
  if (start < 0) return -1;
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] !== null && segments[start + i] !== pattern[i]) return -1;
  }
  return start;
}
