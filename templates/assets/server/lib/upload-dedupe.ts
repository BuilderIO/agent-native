import { createHash } from "node:crypto";

import type { AssetMediaType } from "../../shared/api.js";
import { parseJson } from "./json.js";

export type PreparedAssetUpload = {
  altText: string | null;
  buffer: Buffer;
  contentHash: string;
  filename: string | null;
  mediaType: AssetMediaType;
  metadata: Record<string, unknown>;
  mimeType: string;
  title: string;
};

export type ExistingAssetForDuplicateCheck = {
  id: string;
  title: string | null;
  mediaType: string;
  mimeType: string;
  sizeBytes: number | null;
  metadata: string;
  objectKey: string;
};

export type SkippedAssetUploadDuplicate = {
  filename: string | null;
  reason: "same-upload" | "existing-asset";
  assetId?: string;
  title?: string | null;
};

export const ASSET_DEDUPE_BATCH_SIZE = 100;
export const ASSET_DEDUPE_MAX_CANDIDATES = 200;
export const ASSET_DEDUPE_MAX_PAGES = 2;
export const ASSET_DEDUPE_MAX_CANDIDATE_BYTES = 64 * 1024 * 1024;

export class AssetDedupeSearchLimitError extends Error {
  constructor() {
    super(
      "Asset duplicate checking reached its safety limit. No new assets were created.",
    );
    this.name = "AssetDedupeSearchLimitError";
  }
}

export function hashAssetBuffer(buffer: Buffer | Uint8Array): string {
  return createHash("sha256").update(Buffer.from(buffer)).digest("hex");
}

function uploadFingerprint(mediaType: string, contentHash: string): string {
  return `${mediaType}:${contentHash}`;
}

function getMetadataContentHash(metadataText: string): string | null {
  const metadata = parseJson<Record<string, unknown>>(metadataText, {});
  const contentHash = metadata.contentHash;
  return typeof contentHash === "string" && contentHash ? contentHash : null;
}

function isLegacyCandidate(
  file: PreparedAssetUpload,
  asset: ExistingAssetForDuplicateCheck,
): boolean {
  return (
    asset.mediaType === file.mediaType &&
    asset.mimeType === file.mimeType &&
    asset.sizeBytes === file.buffer.byteLength
  );
}

export async function filterDuplicateAssetUploads(input: {
  files: PreparedAssetUpload[];
  existingAssets: ExistingAssetForDuplicateCheck[];
  readExistingAssetBuffer?: (
    asset: ExistingAssetForDuplicateCheck,
  ) => Promise<Buffer>;
}): Promise<{
  files: PreparedAssetUpload[];
  skippedDuplicates: SkippedAssetUploadDuplicate[];
}> {
  const skippedDuplicates: SkippedAssetUploadDuplicate[] = [];
  const seenUploads = new Set<string>();
  const uniqueUploads: PreparedAssetUpload[] = [];

  for (const file of input.files) {
    const fingerprint = uploadFingerprint(file.mediaType, file.contentHash);
    if (seenUploads.has(fingerprint)) {
      skippedDuplicates.push({
        filename: file.filename,
        reason: "same-upload",
      });
      continue;
    }
    seenUploads.add(fingerprint);
    uniqueUploads.push(file);
  }

  const existingByFingerprint = new Map<
    string,
    ExistingAssetForDuplicateCheck
  >();
  const legacyCandidates: ExistingAssetForDuplicateCheck[] = [];
  for (const asset of input.existingAssets) {
    const contentHash = getMetadataContentHash(asset.metadata);
    if (contentHash) {
      existingByFingerprint.set(
        uploadFingerprint(asset.mediaType, contentHash),
        asset,
      );
    } else {
      legacyCandidates.push(asset);
    }
  }

  const legacyHashByAssetId = new Map<string, string | null>();
  const files: PreparedAssetUpload[] = [];

  for (const file of uniqueUploads) {
    const fingerprint = uploadFingerprint(file.mediaType, file.contentHash);
    let duplicate = existingByFingerprint.get(fingerprint);

    if (!duplicate && input.readExistingAssetBuffer) {
      for (const candidate of legacyCandidates) {
        if (!isLegacyCandidate(file, candidate)) continue;

        let legacyHash = legacyHashByAssetId.get(candidate.id);
        if (legacyHash === undefined) {
          legacyHash = await input
            .readExistingAssetBuffer(candidate)
            .then((buffer) => hashAssetBuffer(buffer))
            .catch((error: unknown) => {
              if (error instanceof AssetDedupeSearchLimitError) throw error;
              return null;
            });
          legacyHashByAssetId.set(candidate.id, legacyHash);
        }

        if (legacyHash === file.contentHash) {
          duplicate = candidate;
          existingByFingerprint.set(fingerprint, candidate);
          break;
        }
      }
    }

    if (duplicate) {
      skippedDuplicates.push({
        filename: file.filename,
        reason: "existing-asset",
        assetId: duplicate.id,
        title: duplicate.title,
      });
      continue;
    }

    files.push(file);
  }

  return { files, skippedDuplicates };
}

export async function filterDuplicateAssetUploadsAcrossBatches(input: {
  files: PreparedAssetUpload[];
  existingAssets: ExistingAssetForDuplicateCheck[];
  readExistingAssetHashes: (
    files: PreparedAssetUpload[],
  ) => Promise<ExistingAssetForDuplicateCheck[]>;
  readExistingAssetBatch: (
    afterId: string | null,
    files: PreparedAssetUpload[],
    limit: number,
  ) => Promise<ExistingAssetForDuplicateCheck[]>;
  readExistingAssetBuffer: (
    asset: ExistingAssetForDuplicateCheck,
  ) => Promise<Buffer>;
  maxCandidates?: number;
  maxPages?: number;
  maxCandidateBytes?: number;
  batchSize?: number;
}): Promise<{
  files: PreparedAssetUpload[];
  skippedDuplicates: SkippedAssetUploadDuplicate[];
}> {
  const unique = await filterDuplicateAssetUploads({
    files: input.files,
    existingAssets: [],
  });
  let pendingFiles = unique.files;
  let afterId: string | null = null;
  let candidatesRead = 0;
  let pagesRead = 0;
  let candidateBytesRead = 0;
  const maxCandidates = input.maxCandidates ?? ASSET_DEDUPE_MAX_CANDIDATES;
  const maxPages = input.maxPages ?? ASSET_DEDUPE_MAX_PAGES;
  const maxCandidateBytes =
    input.maxCandidateBytes ?? ASSET_DEDUPE_MAX_CANDIDATE_BYTES;
  const batchSize = input.batchSize ?? ASSET_DEDUPE_BATCH_SIZE;
  const duplicateByFingerprint = new Map<string, SkippedAssetUploadDuplicate>();

  const readExistingAssetBuffer = async (
    asset: ExistingAssetForDuplicateCheck,
  ) => {
    const expectedBytes = asset.sizeBytes ?? 0;
    if (expectedBytes > maxCandidateBytes - candidateBytesRead) {
      throw new AssetDedupeSearchLimitError();
    }
    const buffer = await input.readExistingAssetBuffer(asset);
    if (buffer.byteLength > maxCandidateBytes - candidateBytesRead) {
      throw new AssetDedupeSearchLimitError();
    }
    candidateBytesRead += buffer.byteLength;
    return buffer;
  };
  const processBatch = async (
    existingAssets: ExistingAssetForDuplicateCheck[],
  ) => {
    if (!pendingFiles.length || !existingAssets.length) return;
    const result = await filterDuplicateAssetUploads({
      files: pendingFiles,
      existingAssets,
      readExistingAssetBuffer,
    });
    const remainingFingerprints = new Set(
      result.files.map((file) =>
        uploadFingerprint(file.mediaType, file.contentHash),
      ),
    );
    let duplicateIndex = 0;
    for (const file of pendingFiles) {
      const fingerprint = uploadFingerprint(file.mediaType, file.contentHash);
      if (remainingFingerprints.has(fingerprint)) continue;
      const duplicate = result.skippedDuplicates[duplicateIndex++];
      if (duplicate) duplicateByFingerprint.set(fingerprint, duplicate);
    }
    pendingFiles = result.files;
  };
  await processBatch(input.existingAssets);
  if (pendingFiles.length) {
    const hashMatches = await input.readExistingAssetHashes(pendingFiles);
    await processBatch(hashMatches);
  }
  while (pendingFiles.length) {
    if (candidatesRead >= maxCandidates || pagesRead >= maxPages) {
      const moreCandidates = await input.readExistingAssetBatch(
        afterId,
        pendingFiles,
        1,
      );
      if (moreCandidates.length) {
        // Fail closed when the bounded scan cannot prove there is no legacy duplicate.
        throw new AssetDedupeSearchLimitError();
      }
      break;
    }
    const pageLimit = Math.min(batchSize, maxCandidates - candidatesRead);
    const existingAssets = await input.readExistingAssetBatch(
      afterId,
      pendingFiles,
      pageLimit,
    );
    if (!existingAssets.length) break;
    if (existingAssets.length > pageLimit) {
      throw new Error(
        "Asset duplicate query exceeded its requested row limit.",
      );
    }
    pagesRead += 1;
    candidatesRead += existingAssets.length;
    await processBatch(existingAssets);
    afterId = existingAssets[existingAssets.length - 1].id;
    if (existingAssets.length < pageLimit) break;
  }

  const skippedDuplicates = [
    ...unique.skippedDuplicates,
    ...unique.files.flatMap((file) => {
      const duplicate = duplicateByFingerprint.get(
        uploadFingerprint(file.mediaType, file.contentHash),
      );
      return duplicate ? [duplicate] : [];
    }),
  ];
  return { files: pendingFiles, skippedDuplicates };
}
