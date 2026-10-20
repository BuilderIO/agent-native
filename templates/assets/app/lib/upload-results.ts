import {
  MAX_ASSET_UPLOAD_BATCH_BYTES,
  MAX_ASSET_UPLOAD_FILES,
  type FailedAssetUpload,
  type SkippedAssetUploadDuplicate,
} from "../../shared/api";

export type AssetUploadResult = {
  count?: number;
  assets?: Array<{ id: string; title?: string | null }>;
  skippedDuplicates?: SkippedAssetUploadDuplicate[];
  errors?: FailedAssetUpload[];
};

export function chunkAssetUploads<T extends { size: number }>(
  files: T[],
  chunkSize = MAX_ASSET_UPLOAD_FILES,
  maxBytes = MAX_ASSET_UPLOAD_BATCH_BYTES,
): T[][] {
  const chunks: T[][] = [];
  let chunk: T[] = [];
  let chunkBytes = 0;
  for (const file of files) {
    if (
      chunk.length &&
      (chunk.length === chunkSize || chunkBytes + file.size > maxBytes)
    ) {
      chunks.push(chunk);
      chunk = [];
      chunkBytes = 0;
    }
    chunk.push(file);
    chunkBytes += file.size;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

export function getUploadedAssetCount(
  result: AssetUploadResult | null | undefined,
): number {
  return typeof result?.count === "number"
    ? result.count
    : (result?.assets?.length ?? 0);
}

export function getSkippedDuplicateCount(
  result: AssetUploadResult | null | undefined,
): number {
  return Array.isArray(result?.skippedDuplicates)
    ? result.skippedDuplicates.length
    : 0;
}

export function getFailedUploadCount(
  result: AssetUploadResult | null | undefined,
): number {
  return Array.isArray(result?.errors) ? result.errors.length : 0;
}
