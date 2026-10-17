export type FileUploadStatus =
  | "unknown"
  | "configured"
  | "missing"
  | "unavailable";

export function canUseChatAttachments(
  chatReady: boolean,
  fileUploadStatus: FileUploadStatus,
): boolean {
  return chatReady && fileUploadStatus === "configured";
}

export function canSendChatMessage(
  chatReady: boolean,
  fileUploadStatus: FileUploadStatus,
  hasAttachments: boolean,
): boolean {
  return chatReady && (!hasAttachments || fileUploadStatus === "configured");
}
