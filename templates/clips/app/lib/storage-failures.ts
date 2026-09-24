const STORAGE_SETUP_FAILURE_RE =
  /video storage is not connected|file upload provider|storage provider|connect builder|s3-compatible/i;

export function isStorageSetupFailureReason(
  reason: string | null | undefined,
): boolean {
  return STORAGE_SETUP_FAILURE_RE.test(reason ?? "");
}
