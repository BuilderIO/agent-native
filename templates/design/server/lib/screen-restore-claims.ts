import { createHash } from "node:crypto";

import {
  annotateScreenHtmlForPersist,
  normalizeScreenHtml,
} from "../../shared/screen-annotation.js";

export function screenRestoreContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function screenRestoreContentHashes(
  content: string,
  fileType: string,
): string[] {
  const sourceCandidates = [content];
  if (fileType === "html") {
    sourceCandidates.push(normalizeScreenHtml(content).content);
  }
  return [
    ...new Set(
      sourceCandidates.map((candidate) =>
        screenRestoreContentHash(
          annotateScreenHtmlForPersist(candidate, fileType),
        ),
      ),
    ),
  ];
}
