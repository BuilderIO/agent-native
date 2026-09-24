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
            .catch(() => null);
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
