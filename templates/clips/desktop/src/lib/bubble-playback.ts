
export const BUBBLE_PLAY_HEARTBEAT_MS = 2000;

export const BUBBLE_RENDER_GRACE_MS = 2500;

export type BubblePlaybackProbe = {
  trackArrivedAt: number | null;
  now: number;
  paused: boolean;
  videoWidth: number;
  alreadyReported: boolean;
};

export function isRenderingWebrtc(
  probe: Pick<BubblePlaybackProbe, "paused" | "videoWidth">,
): boolean {
  return !probe.paused && probe.videoWidth > 0;
}

export function shouldClaimWebrtcPath(input: {
  fallbackRequested: boolean;
  videoWidth: number;
}): boolean {
  if (input.fallbackRequested) return false;
  return input.videoWidth > 0;
}

export function shouldReportUnrendered(probe: BubblePlaybackProbe): boolean {
  if (probe.alreadyReported) return false;
  if (probe.trackArrivedAt == null) return false;
  if (isRenderingWebrtc(probe)) return false;
  return probe.now - probe.trackArrivedAt >= BUBBLE_RENDER_GRACE_MS;
}
