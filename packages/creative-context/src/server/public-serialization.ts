import { creativeContextMediaUrl } from "../media-url.js";
import type {
  BrandDnaVersion,
  BrandProfile,
  ContextDetail,
  ContextJob,
  ContextReviewItem,
} from "../types.js";

const BLOCKED_METADATA_KEY =
  /(?:authorization|token|secret|password|cookie|storageKey|blobRef|rawSnapshot|downloadUrl|providerUrl|leaseToken|leaseOwner|cloneHandle|cloneReference|privateMetadata|nativeClone)/i;
const CAPABILITY_VALUE =
  /(?:creative-context-blob:|private-blob:|https?:\/\/)[^\s<>{}\[\]"']*/gi;

export function sanitizePublicMetadata(value: unknown): unknown {
  if (typeof value === "string") {
    CAPABILITY_VALUE.lastIndex = 0;
    if (!CAPABILITY_VALUE.test(value)) return value;
    CAPABILITY_VALUE.lastIndex = 0;
    const redacted = value.replace(CAPABILITY_VALUE, "[redacted]").trim();
    return redacted === "[redacted]" ? undefined : redacted;
  }
  if (Array.isArray(value)) {
    return value
      .map(sanitizePublicMetadata)
      .filter((entry) => entry !== undefined);
  }
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (BLOCKED_METADATA_KEY.test(key)) continue;
    const sanitized = sanitizePublicMetadata(child);
    if (sanitized !== undefined) output[key] = sanitized;
  }
  return output;
}

export function sanitizePublicString(value: string): string {
  const sanitized = sanitizePublicMetadata(value);
  return typeof sanitized === "string" ? sanitized : "[redacted]";
}

export function serializePublicContextDetail(context: ContextDetail) {
  const { thumbnailBlobRef, provenance, canonicalUrl, ...item } = context.item;
  const sanitizedCanonicalUrl = sanitizePublicMetadata(canonicalUrl);
  const {
    rawSnapshotBlobRef,
    metadata: versionMetadata,
    ...version
  } = context.version;
  return {
    item: {
      ...item,
      canonicalUrl:
        typeof sanitizedCanonicalUrl === "string"
          ? sanitizedCanonicalUrl
          : null,
      provenance: sanitizePublicMetadata(provenance),
      hasThumbnail: Boolean(thumbnailBlobRef),
    },
    version: {
      ...version,
      hasRawSnapshot: Boolean(rawSnapshotBlobRef),
      metadata: sanitizePublicMetadata(versionMetadata),
    },
    chunks: context.chunks.map(({ metadata, ...chunk }) => ({
      ...chunk,
      metadata: sanitizePublicMetadata(metadata),
    })),
    media: context.media.map(
      ({ storageKey, provenanceUrl, url, metadata, ...media }) => ({
        ...media,
        url: creativeContextMediaUrl({ mediaId: media.id }),
        hasOriginal: Boolean(storageKey || provenanceUrl || url),
        metadata: sanitizePublicMetadata(metadata),
      }),
    ),
    edges: context.edges.map(({ metadata, ...edge }) => ({
      ...edge,
      metadata: sanitizePublicMetadata(metadata),
    })),
  };
}

export function serializePublicBrandProfile(input: {
  profile: BrandProfile | null;
  dna: BrandDnaVersion | null;
  versions: BrandDnaVersion[];
}) {
  const sanitizeVersion = (version: BrandDnaVersion | null) =>
    version
      ? {
          ...version,
          payload: sanitizePublicMetadata(version.payload),
        }
      : null;
  return {
    profile: input.profile,
    dna: sanitizeVersion(input.dna),
    versions: input.versions.map((version) => sanitizeVersion(version)!),
  };
}

export function serializePublicJob(job: ContextJob | null) {
  if (!job) return null;
  return {
    id: job.id,
    sourceId: job.sourceId,
    kind: job.kind,
    status: job.status,
    mode: job.mode,
    progressCurrent: job.progressCurrent,
    progressTotal: job.progressTotal,
    attempts: job.attempts,
    nextResumeAt: job.nextResumeAt,
    result: sanitizePublicMetadata(job.result),
    error: sanitizePublicMetadata(job.error) ?? null,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
  };
}

export function serializePublicReviewItems(items: ContextReviewItem[]) {
  return items.map(({ thumbnailBlobRef, provenance, ...item }) => ({
    ...item,
    hasThumbnail: Boolean(thumbnailBlobRef),
    provenance: sanitizePublicMetadata(provenance),
  }));
}
