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
export const MAX_SEARCHABLE_CONTENT_BYTES = 64 * 1024;
export const MAX_SUMMARY_BYTES = 8 * 1024;
export const MAX_NATIVE_CONTENT_BYTES = 128 * 1024;
export const MAX_METADATA_BYTES = 32 * 1024;
export const MAX_MEDIA_TEXT_BYTES = 64 * 1024;
export const MAX_MEDIA_LOCATOR_BYTES = 16 * 1024;

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
  const candidateContent = preserveContent
    ? input.content.replace(/\r\n?/g, "\n").trim()
    : normalizeWhitespace(input.content);
  const content = preserveContent
    ? requireBoundedNativeContent(candidateContent)
    : boundText(candidateContent, MAX_SEARCHABLE_CONTENT_BYTES);
  const summary = input.summary
    ? boundText(normalizeWhitespace(input.summary), MAX_SUMMARY_BYTES)
    : undefined;
  const chunks = boundChunks(input.chunks ?? chunkContextText(content));
  const normalized = {
    externalId,
    kind: required(input.kind, "kind"),
    title,
    ...(input.canonicalUrl ? { canonicalUrl: input.canonicalUrl } : {}),
    ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    content,
    ...(summary ? { summary } : {}),
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
  return {
    ...normalized,
    contentHash: hashContextVersion(normalized),
  };
}

function boundText(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let bytes = 0;
  let endOffset = 0;
  for (const codePoint of value) {
    const codePointBytes = Buffer.byteLength(codePoint, "utf8");
    if (bytes + codePointBytes > maxBytes) break;
    bytes += codePointBytes;
    endOffset += codePoint.length;
  }
  return value.slice(0, endOffset);
}

function requireBoundedNativeContent(value: string): string {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes > MAX_NATIVE_CONTENT_BYTES) {
    throw new Error(
      `Creative context native content is ${bytes} bytes and exceeds the ${MAX_NATIVE_CONTENT_BYTES}-byte SQL inline limit; split the artifact or store it in private blob storage instead of truncating it`,
    );
  }
  return value;
}

export function assertContextItemSqlTextLimits(
  item: Pick<
    NormalizedContextItem,
    | "content"
    | "summary"
    | "mimeType"
    | "provenance"
    | "metadata"
    | "chunks"
    | "media"
    | "edges"
  >,
): void {
  const nativeArtifact = item.metadata?.nativeArtifact;
  const isNativeContent =
    item.mimeType === "text/html" &&
    typeof nativeArtifact === "object" &&
    nativeArtifact !== null &&
    !Array.isArray(nativeArtifact) &&
    ((nativeArtifact as Record<string, unknown>).format === "slides-html" ||
      (nativeArtifact as Record<string, unknown>).format === "design-html");
  const contentLimit = isNativeContent
    ? MAX_NATIVE_CONTENT_BYTES
    : MAX_SEARCHABLE_CONTENT_BYTES;
  assertSqlTextLimit(
    isNativeContent ? "native content" : "searchable content",
    item.content,
    contentLimit,
    isNativeContent
      ? "split the artifact or store it in private blob storage"
      : "normalize or chunk the source before ingest",
  );
  if (item.summary) {
    assertSqlTextLimit(
      "summary",
      item.summary,
      MAX_SUMMARY_BYTES,
      "normalize the summary before ingest",
    );
  }
  assertJsonSqlTextLimit(
    "item metadata",
    item.metadata,
    MAX_METADATA_BYTES,
    "move raw payloads to private blob storage before ingest",
  );
  assertJsonSqlTextLimit(
    "item provenance",
    item.provenance,
    MAX_METADATA_BYTES,
    "move raw payloads to private blob storage before ingest",
  );
  let chunkBytes = 0;
  for (const chunk of item.chunks ?? []) {
    chunkBytes += Buffer.byteLength(chunk.text, "utf8");
    if (chunkBytes > MAX_SEARCHABLE_CONTENT_BYTES) {
      throw new Error(
        `Creative context chunks exceed the ${MAX_SEARCHABLE_CONTENT_BYTES}-byte SQL text limit; normalize or split the chunks before ingest`,
      );
    }
    assertJsonSqlTextLimit(
      "chunk metadata",
      chunk.metadata,
      MAX_METADATA_BYTES,
      "move raw payloads to private blob storage before ingest",
    );
  }
  for (const media of item.media ?? []) {
    for (const [label, value] of [
      ["media alt text", media.altText],
      ["media caption", media.caption],
      ["media OCR text", media.ocrText],
    ] as const) {
      if (value) {
        assertSqlTextLimit(
          label,
          value,
          MAX_MEDIA_TEXT_BYTES,
          "move raw payloads to private blob storage before ingest",
        );
      }
    }
    for (const [label, value] of [
      ["media URL", media.url],
      ["media storage key", media.storageKey],
      ["media provenance URL", media.provenanceUrl],
    ] as const) {
      if (!value) continue;
      if (value.trim().toLowerCase().startsWith("data:")) {
        throw new Error(
          `Creative context ${label} cannot be an inline data URL; store the payload in private blob storage instead`,
        );
      }
      assertSqlTextLimit(
        label,
        value,
        MAX_MEDIA_LOCATOR_BYTES,
        "move raw payloads to private blob storage before ingest",
      );
    }
    assertJsonSqlTextLimit(
      "media metadata",
      media.metadata,
      MAX_METADATA_BYTES,
      "move raw payloads to private blob storage before ingest",
    );
  }
  for (const edge of item.edges ?? []) {
    assertJsonSqlTextLimit(
      "edge metadata",
      edge.metadata,
      MAX_METADATA_BYTES,
      "move raw payloads to private blob storage before ingest",
    );
  }
}

function assertJsonSqlTextLimit(
  label: string,
  value: unknown,
  maxBytes: number,
  guidance: string,
): void {
  if (value === undefined) return;
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return;
  assertSqlTextLimit(label, serialized, maxBytes, guidance);
}

function assertSqlTextLimit(
  label: string,
  value: string,
  maxBytes: number,
  guidance: string,
): void {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes > maxBytes) {
    throw new Error(
      `Creative context ${label} is ${bytes} bytes and exceeds the ${maxBytes}-byte SQL text limit; ${guidance}`,
    );
  }
}

function boundChunks(
  chunks: NormalizedContextChunk[],
): NormalizedContextChunk[] {
  let remaining = MAX_SEARCHABLE_CONTENT_BYTES;
  return chunks.flatMap((chunk) => {
    if (remaining <= 0) return [];
    const text = boundText(chunk.text, remaining);
    remaining -= Buffer.byteLength(text, "utf8");
    return text
      ? [
          {
            ...chunk,
            text,
            endOffset:
              chunk.startOffset == null
                ? chunk.endOffset
                : chunk.startOffset + text.length,
          },
        ]
      : [];
  });
}

export function hashContextContent(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function hashContextVersion(
  item: Omit<NormalizedContextItem, "contentHash">,
): string {
  return hashContextContent({
    externalId: item.externalId,
    kind: item.kind,
    title: item.title,
    content: item.content,
    summary: item.summary ?? null,
    mimeType: item.mimeType ?? null,
    sourceVersion: item.sourceVersion ?? null,
    rawSnapshotBlobRef: item.rawSnapshotBlobRef ?? null,
    parseStatus: item.parseStatus ?? "parsed",
    parseError: item.parseError ?? null,
    metadata: withoutVolatileCaptureMetadata(item.metadata ?? {}),
    chunks: canonicalUnordered(item.chunks ?? [], (chunk) => ({
      ordinal: chunk.ordinal,
      kind: chunk.kind ?? "text",
      text: chunk.text,
      startOffset: chunk.startOffset ?? null,
      endOffset: chunk.endOffset ?? null,
      tokenCount: chunk.tokenCount ?? null,
      metadata: chunk.metadata ?? {},
    })),
    media: canonicalUnordered(item.media ?? [], (entry) => ({
      id: entry.id ?? null,
      kind: entry.kind,
      mimeType: entry.mimeType ?? null,
      accessMode: entry.accessMode ?? "public",
      url: entry.url ?? null,
      storageKey: entry.storageKey ?? null,
      provenanceUrl: entry.provenanceUrl ?? null,
      altText: entry.altText ?? null,
      caption: entry.caption ?? null,
      captionStatus: entry.captionStatus ?? "pending",
      ocrText: entry.ocrText ?? null,
      palette: entry.palette ?? [],
      contentHash: entry.contentHash ?? null,
      width: entry.width ?? null,
      height: entry.height ?? null,
      durationMs: entry.durationMs ?? null,
      metadata: entry.metadata ?? {},
    })),
    edges: canonicalUnordered(item.edges ?? [], (edge) => ({
      id: edge.id ?? null,
      relation: edge.relation,
      toItemId: edge.toItemId ?? null,
      toItemVersionId: edge.toItemVersionId ?? null,
      toExternalId: edge.toExternalId ?? null,
      metadata: edge.metadata ?? {},
    })),
  });
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

function canonicalUnordered<T, U>(
  values: readonly T[],
  canonicalize: (value: T) => U,
): U[] {
  return values
    .map(canonicalize)
    .sort((left, right) =>
      stableJson(left) < stableJson(right)
        ? -1
        : stableJson(left) > stableJson(right)
          ? 1
          : 0,
    );
}

function withoutVolatileCaptureMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const { capturedAt: _capturedAt, ...stableMetadata } = metadata;
  return stableMetadata;
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function looksLikeOpaqueId(value: string): boolean {
  return value.length > 30 && /^[A-Za-z0-9_-]+$/.test(value);
}
