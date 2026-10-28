import { enabledFlag } from "./env-flags.js";

export function isStreamingUploadDisabled(): boolean {
  return enabledFlag(process.env.CLIPS_DISABLE_STREAMING_UPLOAD);
}

export function shouldEnableStreamingUpload(args: {
  client?: string | null;
  mimeType?: string | null;
  bufferedFallbackAvailable?: boolean;
}): boolean {
  if (isStreamingUploadDisabled()) return false;
  if (
    args.bufferedFallbackAvailable !== false &&
    !enabledFlag(process.env.CLIPS_ENABLE_STREAMING_UPLOAD)
  ) {
    return false;
  }

  const mimeType = (args.mimeType ?? "").split(";")[0]?.trim().toLowerCase();
  return !mimeType || mimeType.startsWith("video/");
}
