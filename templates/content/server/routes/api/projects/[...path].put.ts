import { defineEventHandler, createError } from "h3";
import { saveFile } from "../../../handlers/projects.js";
import { saveResearch } from "../../../handlers/research.js";

export default defineEventHandler(async (event) => {
  const path = (event.context.params?.path as string) || "";
  const segments = path.split("/");

  // /api/projects/**:project/research
  const researchIdx = findSuffix(segments, ["research"]);
  if (researchIdx >= 0) {
    setProjectParam(event, segments.slice(0, researchIdx));
    return saveResearch(event);
  }

  // /api/projects/**:project/file
  const fileIdx = findSuffix(segments, ["file"]);
  if (fileIdx >= 0) {
    setProjectParam(event, segments.slice(0, fileIdx));
    return saveFile(event);
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
