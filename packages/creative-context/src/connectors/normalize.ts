import { createHash } from "node:crypto";

import type {
  ContextCurationRank,
  ContextCurationStatus,
  ContextEdgeInput,
  ContextMediaInput,
  NormalizedContextChunk,
  NormalizedContextItem,
  UpstreamAccess,
} from "../types.js";

const DEFAULT_CHUNK_CHARS = 4_000;

export interface NormalizeContextItemInput {
  externalId: string;
  kind: string;
  title: string;
  content: string;
  preserveContent?: boolean;
  canonicalUrl?: string;
  mimeType?: string;
  summary?: string;
  sourceModifiedAt?: string;
  sourceVersion?: string;
  rawSnapshotBlobRef?: string;
  parseStatus?: "pending" | "parsed" | "failed";
  parseError?: string;
  upstreamAccess?: UpstreamAccess;
  curationStatus?: ContextCurationStatus;
  curationRank?: ContextCurationRank;
  thumbnailBlobRef?: string;
  provenance?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  chunks?: NormalizedContextChunk[];
  media?: ContextMediaInput[];
  edges?: ContextEdgeInput[];
}

export function normalizeContextItem(
  input: NormalizeContextItemInput,
): NormalizedContextItem {
  const externalId = required(input.externalId, "externalId");
  const title = required(input.title, "title");
  const nativeArtifact =
    input.metadata &&
    typeof input.metadata === "object" &&
    !Array.isArray(input.metadata) &&
    input.metadata.nativeArtifact &&
    typeof input.metadata.nativeArtifact === "object" &&
    !Array.isArray(input.metadata.nativeArtifact)
      ? (input.metadata.nativeArtifact as Record<string, unknown>)
      : null;
  const preserveContent =
    input.preserveContent === true ||
    (input.mimeType === "text/html" &&
      (nativeArtifact?.format === "slides-html" ||
        nativeArtifact?.format === "design-html"));
  const content = preserveContent
    ? input.content.replace(/\r\n?/g, "\n").trim()
    : normalizeWhitespace(input.content);
  const chunks = input.chunks ?? chunkContextText(content);
  return {
    externalId,
    kind: required(input.kind, "kind"),
    title,
    ...(input.canonicalUrl ? { canonicalUrl: input.canonicalUrl } : {}),
    ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    content,
    ...(input.summary ? { summary: normalizeWhitespace(input.summary) } : {}),
    contentHash: hashContextContent({
      externalId,
      title,
      content,
      mimeType: input.mimeType ?? null,
    }),
    ...(input.sourceModifiedAt
      ? { sourceModifiedAt: input.sourceModifiedAt }
      : {}),
    ...(input.sourceVersion ? { sourceVersion: input.sourceVersion } : {}),
    ...(input.rawSnapshotBlobRef
      ? { rawSnapshotBlobRef: input.rawSnapshotBlobRef }
      : {}),
    ...(input.parseStatus ? { parseStatus: input.parseStatus } : {}),
    ...(input.parseError ? { parseError: input.parseError } : {}),
    ...(input.upstreamAccess ? { upstreamAccess: input.upstreamAccess } : {}),
    ...(input.curationStatus ? { curationStatus: input.curationStatus } : {}),
    ...(input.curationRank ? { curationRank: input.curationRank } : {}),
    ...(input.thumbnailBlobRef
      ? { thumbnailBlobRef: input.thumbnailBlobRef }
      : {}),
    ...(input.provenance ? { provenance: input.provenance } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
    ...(chunks.length > 0 ? { chunks } : {}),
    ...(input.media?.length ? { media: input.media } : {}),
    ...(input.edges?.length ? { edges: input.edges } : {}),
  };
}

export function hashContextContent(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function chunkContextText(
  input: string,
  maxChars = DEFAULT_CHUNK_CHARS,
): NormalizedContextChunk[] {
  const text = normalizeWhitespace(input);
  if (!text) return [];
  const chunks: NormalizedContextChunk[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + maxChars);
    if (end < text.length) {
      const boundary = Math.max(
        text.lastIndexOf("\n\n", end),
        text.lastIndexOf(". ", end),
      );
      if (boundary > start + Math.floor(maxChars / 2)) {
        end = boundary + (text.startsWith("\n\n", boundary) ? 2 : 1);
      }
    }
    const chunk = text.slice(start, end).trim();
    if (chunk) {
      chunks.push({
        ordinal: chunks.length,
        kind: "text",
        text: chunk,
        startOffset: start,
        endOffset: end,
      });
    }
    start = end;
  }
  return chunks;
}

export function collectProviderText(
  value: unknown,
  options: { skipKeys?: readonly string[]; maxChars?: number } = {},
): string {
  const skip = new Set([
    "id",
    "url",
    "href",
    "etag",
    "thumbnailUrl",
    ...(options.skipKeys ?? []),
  ]);
  const values: string[] = [];
  const maxChars = options.maxChars ?? 2_000_000;
  const visit = (current: unknown, key?: string): void => {
    if (values.join("\n").length >= maxChars || skip.has(key ?? "")) return;
    if (typeof current === "string") {
      const normalized = normalizeWhitespace(current);
      if (normalized && !looksLikeOpaqueId(normalized)) values.push(normalized);
      return;
    }
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    if (!current || typeof current !== "object") return;
    for (const [childKey, child] of Object.entries(current)) {
      visit(child, childKey);
    }
  };
  visit(value);
  return normalizeWhitespace(values.join("\n")).slice(0, maxChars);
}

export function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function looksLikeOpaqueId(value: string): boolean {
  return value.length > 30 && /^[A-Za-z0-9_-]+$/.test(value);
}
