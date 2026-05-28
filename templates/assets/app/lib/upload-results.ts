import {
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

export function chunkAssetUploads<T>(
  files: T[],
  chunkSize = MAX_ASSET_UPLOAD_FILES,
): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < files.length; index += chunkSize) {
    chunks.push(files.slice(index, index + chunkSize));
  }
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
