export function shouldKeepBubbleSession({
  wantsCamera,
  popoverVisible,
  recordingInFlight,
}: {
  wantsCamera: boolean;
  popoverVisible: boolean;
  recordingInFlight: boolean;
}): boolean {
  return wantsCamera && (popoverVisible || recordingInFlight);
}
