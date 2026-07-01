// Temporary kill switch: streaming resumable uploads caused a spike of
// recording issues. Set CLIPS_DISABLE_STREAMING_UPLOAD=false to re-enable
// once the root cause is fixed. Defaults to disabled (streaming off).
export function isStreamingUploadDisabled(): boolean {
  const flag = process.env.CLIPS_DISABLE_STREAMING_UPLOAD ?? "";
  return flag.toLowerCase() !== "false";
}
