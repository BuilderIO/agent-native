import type { FileUploadResult } from "@agent-native/core/file-upload";

export const S3_UPLOAD_PROVIDER_ID = "s3";
export const CLIPS_HOSTED_UPLOAD_PROVIDER_ID = "clips-hosted";

export function isUploadPrivateToCaller(upload: FileUploadResult): boolean {
  return (
    upload.provider === S3_UPLOAD_PROVIDER_ID ||
    upload.provider === CLIPS_HOSTED_UPLOAD_PROVIDER_ID
  );
}
