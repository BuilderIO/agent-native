import { createHash } from "node:crypto";

export function documentContentHash(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export function documentRevisionToken(
  revision: number,
  content: string,
): string {
  return `body:${revision}:${documentContentHash(content)}`;
}

export function parseDocumentRevisionToken(
  value: string,
): { revision: number; contentHash: string } | null {
  const match = /^body:(0|[1-9]\d*):(sha256:[a-f0-9]{64})$/.exec(value);
  if (!match) return null;
  const revision = Number(match[1]);
  return Number.isSafeInteger(revision)
    ? { revision, contentHash: match[2]! }
    : null;
}
