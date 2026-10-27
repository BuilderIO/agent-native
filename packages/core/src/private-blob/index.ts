export type {
  PrivateBlobByteRange,
  PrivateBlobDeleteResult,
  PrivateBlobHandle,
  PrivateBlobMetadata,
  PrivateBlobProvider,
  PrivateBlobPutInput,
  PrivateBlobPutRequest,
  PrivateBlobRangeReadResult,
  PrivateBlobReadResult,
  PrivateBlobReadUrl,
  PrivateBlobReadUrlOptions,
} from "./types.js";
export type {
  AttachmentFailure,
  AttachmentFile,
  AttachmentRef,
  AttachmentResolution,
  AttachmentScope,
  DeleteAttachmentResult,
  MintAttachmentResult,
  StorageFixer,
  StorageUnavailable,
  StorageUnavailableReason,
} from "./attachment-ref.js";
export {
  ATTACHMENT_REF_MAX_CHARS,
  ATTACHMENT_REF_PREFIX,
  LEGACY_SLIDES_UPLOAD_REF_PREFIX,
  attachmentOwnerKey,
  deleteAttachment,
  isAttachmentRef,
  isAttachmentEncryptionKeyAvailable,
  isRetryableAttachmentFailure,
  mintAttachmentRef,
  resolveAttachment,
} from "./attachment-ref.js";
export type {
  AttachmentErrorCode,
  AttachmentFailureDescription,
  AttachmentFailureDetails,
  AttachmentOperation,
} from "./attachment-errors.js";
export {
  ATTACHMENT_ERROR_CODES,
  AttachmentStorageUnavailableError,
  AttachmentUnavailableError,
  attachmentFailureDetails,
  attachmentFailureToError,
  describeAttachmentFailure,
  isAttachmentError,
  unwrapAttachment,
} from "./attachment-errors.js";
export type { PrivateBlobFailureKind } from "./errors.js";
export {
  PrivateBlobError,
  PrivateBlobRangeError,
  isPrivateBlobError,
} from "./errors.js";
export {
  deletePrivateBlob,
  getActivePrivateBlobProvider,
  getActivePrivateBlobProviderForRequest,
  getPrivateBlobReadUrl,
  getPrivateBlobStorageReadinessForRequest,
  isPrivateBlobConfiguredForRequest,
  listPrivateBlobProviders,
  putPrivateBlob,
  readPrivateBlob,
  readPrivateBlobRange,
  registerPrivateBlobProvider,
  setPrivateBlobPublicUploadFallbackEnabled,
  unregisterPrivateBlobProvider,
} from "./registry.js";
export type { PrivateBlobStorageReadiness } from "./registry.js";
export {
  HOSTED_PRIVATE_BLOB_PROVIDER_ID,
  S3_PRIVATE_BLOB_PROVIDER_ID,
  ensureS3PrivateBlobProviders,
  hostedPrivateBlobProvider,
  s3PrivateBlobProvider,
} from "./s3-private.js";
