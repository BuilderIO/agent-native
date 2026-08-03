import { createHash } from "node:crypto";

export function stableId(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\u001f")).digest("hex");
}

export function itemDedupeKey(
  input: {
    source: string;
    externalId: string;
    repository?: string;
    pullRequestNumber?: number;
    headSha?: string;
  },
  organizationId = "",
): string {
  return stableId(
    organizationId,
    input.source,
    input.externalId,
    input.repository ?? "",
    input.pullRequestNumber === undefined
      ? ""
      : String(input.pullRequestNumber),
    input.headSha ?? "",
  );
}
