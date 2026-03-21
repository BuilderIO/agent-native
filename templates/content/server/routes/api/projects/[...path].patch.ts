import { defineEventHandler, createError } from "h3";
import {
  renameProject,
  moveProject,
  updateProjectMeta,
} from "../../../handlers/projects.js";

export default defineEventHandler(async (event) => {
  const path = (event.context.params?.path as string) || "";
  const segments = path.split("/");

  // /api/projects/**:project/rename
  const renameIdx = findSuffix(segments, ["rename"]);
  if (renameIdx >= 0) {
    setProjectParam(event, segments.slice(0, renameIdx));
    return renameProject(event);
  }

  // /api/projects/**:project/move
  const moveIdx = findSuffix(segments, ["move"]);
  if (moveIdx >= 0) {
    setProjectParam(event, segments.slice(0, moveIdx));
    return moveProject(event);
  }

  // /api/projects/**:project/meta
  const metaIdx = findSuffix(segments, ["meta"]);
  if (metaIdx >= 0) {
    setProjectParam(event, segments.slice(0, metaIdx));
    return updateProjectMeta(event);
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
