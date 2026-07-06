import { enabledFlag } from "./env-flags.js";

// Emergency kill switch for streaming resumable uploads. Requested Clips video
// uploads use the resumable path by default when the active provider supports
// it; set CLIPS_DISABLE_STREAMING_UPLOAD=1 to force the buffered fallback.
export function isStreamingUploadDisabled(): boolean {
  return enabledFlag(process.env.CLIPS_DISABLE_STREAMING_UPLOAD);
}

export function shouldEnableStreamingUpload(args: {
  client?: string | null;
  mimeType?: string | null;
}): boolean {
  if (isStreamingUploadDisabled()) return false;
  if (enabledFlag(process.env.CLIPS_ENABLE_STREAMING_UPLOAD)) return true;

  const mimeType = (args.mimeType ?? "").split(";")[0]?.trim().toLowerCase();
  return !mimeType || mimeType.startsWith("video/");
}
