import { enabledFlag } from "./env-flags.js";

// Streaming resumable uploads are deployment opt-in while the provider/finalize
// path hardens. Set CLIPS_ENABLE_STREAMING_UPLOAD=1 to allow recorder requests;
// CLIPS_DISABLE_STREAMING_UPLOAD=1 still forces the buffered fallback.
export function isStreamingUploadDisabled(): boolean {
  return enabledFlag(process.env.CLIPS_DISABLE_STREAMING_UPLOAD);
}

export function shouldEnableStreamingUpload(args: {
  client?: string | null;
  mimeType?: string | null;
}): boolean {
  if (isStreamingUploadDisabled()) return false;
  if (!enabledFlag(process.env.CLIPS_ENABLE_STREAMING_UPLOAD)) return false;

  const mimeType = (args.mimeType ?? "").split(";")[0]?.trim().toLowerCase();
  return !mimeType || mimeType.startsWith("video/");
}
