import { createHash } from "node:crypto";

import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import {
  extractDominantColors,
  fingerprintMedia,
  readBoundedResponseBytes,
} from "@agent-native/core/ingestion";
import {
  putPrivateBlob as corePutPrivateBlob,
  readPrivateBlob as coreReadPrivateBlob,
  type PrivateBlobHandle,
} from "@agent-native/core/private-blob";

import type { ContextMediaInput } from "../types.js";
import type { ContextConnectorExecutionContext } from "./types.js";

const PRIVATE_BLOB_REF_PREFIX = "creative-context-blob:v1:";
const MAX_REMOTE_ARTIFACT_BYTES = 20 * 1024 * 1024;

export async function storePrivateArtifact(input: {
  data: Uint8Array;
  filename: string;
  mimeType?: string;
  context: ContextConnectorExecutionContext;
  metadata?: Record<string, string | number | boolean | null | undefined>;
}): Promise<{
  handle: PrivateBlobHandle;
  reference: string;
  contentHash: string;
  palette: string[];
}> {
  const put = input.context.putPrivateBlob ?? corePutPrivateBlob;
  const fingerprint = fingerprintMedia(input.data, input.mimeType);
  const ownerScope = createHash("sha256")
    .update(
      JSON.stringify({
        appId: input.context.appId,
        ownerEmail: input.context.ownerEmail ?? null,
      }),
    )
    .digest("hex")
    .slice(0, 24);
  const handle = await put({
    data: input.data,
    key: `creative-context/${ownerScope}/${fingerprint.sha256}`,
    filename: input.filename,
    mimeType: input.mimeType,
    ownerEmail: input.context.ownerEmail,
    metadata: {
      ...input.metadata,
      sha256: fingerprint.sha256,
      byteLength: fingerprint.byteLength,
    },
  });
  if (!handle) {
    throw new Error(
      "Private blob storage is required for creative context artifacts.",
    );
  }
  const palette = input.mimeType?.startsWith("image/")
    ? await extractDominantColors(input.data).catch(() => [])
    : [];
  return {
    handle,
    reference: serializePrivateBlobHandle(handle),
    contentHash: fingerprint.sha256,
    palette,
  };
}

export async function rehostRemoteMedia(input: {
  url: string;
  provenanceUrl?: string;
  filename: string;
  kind: ContextMediaInput["kind"];
  mimeType?: string;
  context: ContextConnectorExecutionContext;
  metadata?: Record<string, unknown>;
}): Promise<ContextMediaInput> {
  const remote = await fetchRemoteArtifact(input.url, input.context);
  const mimeType = input.mimeType ?? remote.mimeType;
  const data = sanitizeRemoteArtifact({
    data: remote.data,
    mimeType,
    filename: input.filename,
  });
  const stored = await storePrivateArtifact({
    data,
    filename: input.filename,
    mimeType,
    context: input.context,
    metadata: { kind: input.kind, source: "creative-context-import" },
  });
  return {
    kind: input.kind,
    ...(mimeType ? { mimeType } : {}),
    accessMode: "private",
    storageKey: stored.reference,
    provenanceUrl: sanitizeProvenanceUrl(
      input.provenanceUrl ?? remote.finalUrl,
    ),
    contentHash: stored.contentHash,
    ...(stored.palette.length > 0 ? { palette: stored.palette } : {}),
    captionStatus: input.kind === "image" ? "pending" : "not-needed",
    metadata: input.metadata,
  };
}

export async function fetchRemoteArtifact(
  url: string,
  context: ContextConnectorExecutionContext,
): Promise<{ data: Uint8Array; mimeType?: string; finalUrl: string }> {
  const response = await ssrfSafeFetch(
    url,
    { signal: context.signal },
    { maxRedirects: 5 },
  );
  if (!response.ok) {
    throw new Error(`Media fetch failed (${response.status}).`);
  }
  return {
    data: await readBoundedResponseBytes(response, MAX_REMOTE_ARTIFACT_BYTES),
    mimeType: response.headers.get("content-type") ?? undefined,
    finalUrl: sanitizeProvenanceUrl(response.url || url),
  };
}

export function sanitizeProvenanceUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "redacted-source";
  }
}

export function sanitizeRemoteArtifact(input: {
  data: Uint8Array;
  mimeType?: string;
  filename?: string;
}): Uint8Array {
  const mimeType = input.mimeType?.split(";")[0]?.trim().toLowerCase();
  const prefix = new TextDecoder().decode(input.data.slice(0, 512));
  const isSvg =
    mimeType === "image/svg+xml" ||
    ((!mimeType ||
      mimeType === "application/octet-stream" ||
      mimeType === "text/xml" ||
      mimeType === "application/xml") &&
      input.filename?.toLowerCase().endsWith(".svg") === true) ||
    /^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(prefix);
  if (!isSvg) return input.data;

  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(input.data);
  } catch {
    throw new Error("Remote SVG is not valid UTF-8.");
  }
  source = source
    .replace(/^\uFEFF/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  if (!/<svg\b/i.test(source)) {
    throw new Error("Remote SVG is missing an SVG root element.");
  }
  const forbidden = [
    /<\s*(?:script|foreignObject|iframe|object|embed|link|audio|video|animate|set|discard)\b/i,
    /<!\s*(?:DOCTYPE|ENTITY)\b/i,
    /<\?xml-stylesheet\b/i,
    /\son[a-z][a-z0-9:_-]*\s*=/i,
    /\b(?:javascript|vbscript)\s*:/i,
    /\b(?:expression|behavior|-moz-binding)\s*\(/i,
    /@import\b/i,
  ];
  if (forbidden.some((pattern) => pattern.test(source))) {
    throw new Error("Remote SVG contains active content.");
  }
  for (const match of source.matchAll(
    /(?:href|xlink:href)\s*=\s*(["'])(.*?)\1/gi,
  )) {
    const target = match[2]?.trim() ?? "";
    if (
      target &&
      !target.startsWith("#") &&
      !/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(target)
    ) {
      throw new Error("Remote SVG contains an external reference.");
    }
  }
  for (const match of source.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) {
    const target = match[2]?.trim() ?? "";
    if (
      target &&
      !target.startsWith("#") &&
      !/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(target)
    ) {
      throw new Error("Remote SVG contains an external reference.");
    }
  }
  return new TextEncoder().encode(source);
}

export async function readPrivateArtifact(
  handle: PrivateBlobHandle,
  context: ContextConnectorExecutionContext,
): Promise<Uint8Array> {
  const read = context.readPrivateBlob ?? coreReadPrivateBlob;
  return (await read(handle)).data;
}

export function serializePrivateBlobHandle(handle: PrivateBlobHandle): string {
  return `${PRIVATE_BLOB_REF_PREFIX}${Buffer.from(JSON.stringify(handle), "utf8").toString("base64url")}`;
}

export function parsePrivateBlobHandle(
  value: unknown,
): PrivateBlobHandle | null {
  if (value && typeof value === "object") {
    return validateHandle(value as Record<string, unknown>);
  }
  if (typeof value !== "string" || !value.startsWith(PRIVATE_BLOB_REF_PREFIX)) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(
        value.slice(PRIVATE_BLOB_REF_PREFIX.length),
        "base64url",
      ).toString("utf8"),
    ) as Record<string, unknown>;
    return validateHandle(parsed);
  } catch {
    return null;
  }
}

function validateHandle(
  value: Record<string, unknown>,
): PrivateBlobHandle | null {
  return typeof value.id === "string" &&
    typeof value.provider === "string" &&
    value.opaque === true &&
    typeof value.encrypted === "boolean"
    ? (value as unknown as PrivateBlobHandle)
    : null;
}
