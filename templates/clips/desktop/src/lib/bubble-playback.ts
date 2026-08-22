/**
 * When the camera bubble may declare its WebRTC video dead.
 *
 * WKWebView refuses to start a MediaStream-backed `<video>` that has had no
 * user gesture in its page, and pauses one again whenever the owning window
 * loses on-screen area. Neither shows up as an ICE failure, so the bubble's
 * transport can be perfectly connected while the user stares at WebKit's
 * start-playback overlay — a black circle with a white triangle. The bubble
 * retries `play()` on a heartbeat, and uses the predicates here to decide when
 * retrying has stopped being plausible and the popover should be asked for the
 * canvas pump instead.
 */

/** Re-play cadence for the WKWebView pause/block trap — matches `bubble-pump.ts`. */
export const BUBBLE_PLAY_HEARTBEAT_MS = 2000;

/**
 * How long a WebRTC track may sit without producing frames before we give up
 * on it. Long enough to cover a slow first decode, short enough that the user
 * is not left wondering whether the camera is broken.
 */
export const BUBBLE_RENDER_GRACE_MS = 2500;

export type BubblePlaybackProbe = {
  /** When the current track arrived, or `null` when there is no track yet. */
  trackArrivedAt: number | null;
  now: number;
  paused: boolean;
  /** `0` until WebKit has decoded a frame, so it is the honest render signal. */
  videoWidth: number;
  alreadyReported: boolean;
};

/**
 * Whether WebRTC video is actually on screen. `videoWidth > 0` is the part
 * that matters: a `<video>` reports `paused === false` the moment `play()`
 * resolves, well before any frame is decoded, so "playing" alone is not proof
 * the user can see anything.
 */
export function isRenderingWebrtc(
  probe: Pick<BubblePlaybackProbe, "paused" | "videoWidth">,
): boolean {
  return !probe.paused && probe.videoWidth > 0;
}

/** Whether the bubble should ask the popover to fall back to the canvas pump. */
export function shouldReportUnrendered(probe: BubblePlaybackProbe): boolean {
  if (probe.alreadyReported) return false;
  if (probe.trackArrivedAt == null) return false;
  if (isRenderingWebrtc(probe)) return false;
  return probe.now - probe.trackArrivedAt >= BUBBLE_RENDER_GRACE_MS;
}
