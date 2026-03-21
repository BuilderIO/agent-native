import { defineEventHandler, createError } from "h3";
import { deleteProject, deleteFile } from "../../../handlers/projects.js";
import { deleteMedia } from "../../../handlers/media.js";

export default defineEventHandler(async (event) => {
  const path = (event.context.params?.path as string) || "";
  const segments = path.split("/");

  // /api/projects/**:project/media/:filename
  const mediaFileIdx = findSuffix(segments, ["media", null]);
  if (mediaFileIdx >= 0) {
    setProjectParam(event, segments.slice(0, mediaFileIdx));
    event.context.params!.filename = segments[mediaFileIdx + 1];
    return deleteMedia(event);
  }

  // /api/projects/**:project/file
  const fileIdx = findSuffix(segments, ["file"]);
  if (fileIdx >= 0) {
    setProjectParam(event, segments.slice(0, fileIdx));
    return deleteFile(event);
  }

  // /api/projects/**:project (delete project — catch-all fallback)
  setProjectParam(event, segments);
  return deleteProject(event);
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
