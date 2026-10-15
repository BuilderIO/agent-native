/** Frame length assumed when the browser can't report presented frames. */
export const FALLBACK_FRAME_SECONDS = 1 / 30;

const DURATION_SAMPLES = 15;
// One step back can measure a held still screen; a few samples outvote it.
const MIN_DURATION_SAMPLES = 3;
// Until the frame length is measured, search finely enough for 60 fps.
const UNMEASURED_PRECISION_SECONDS = 0.5 / 60;
const MAX_DURATION_SAMPLE_SECONDS = 1;
const PRESENTED_FRAME_TIMEOUT_MS = 1000;
// Doubling from 1.5 frames, this reaches past any clip, so a long-held still
// screen can't stall a step; seeking past the clip's end stops it sooner.
const MAX_FORWARD_PROBES = 24;
// Each narrowing probe halves the span, so this covers the widest probe.
const MAX_NARROWING_PROBES = MAX_FORWARD_PROBES + 2;
// A paused video reports the seek target as its time; anything further off
// means another seek took over.
const SEEK_MATCH_SECONDS = 0.001;

interface FrameMetadata {
  mediaTime: number;
  presentedFrames: number;
  presentationTime: number;
}

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    callback: (now: number, metadata: FrameMetadata) => void,
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export interface ExcludedRange {
  startMs: number;
  endMs: number;
}

/**
 * Whole milliseconds that show the frame starting at `mediaTimeSeconds`.
 * Browsers show the frame whose span contains the seek time, start included,
 * so rounding a sub-millisecond start (30 fps MP4) up stays on that frame
 * where rounding down would land on the one before it.
 */
export function frameTimeMs(mediaTimeSeconds: number): number {
  return Math.ceil(Math.round(mediaTimeSeconds * 1_000_000) / 1000);
}

/**
 * Follows the frames a video element actually presents, through
 * `requestVideoFrameCallback`, and learns the clip's frame length from
 * consecutive frames during playback.
 */
export class VideoFrameClock {
  private handle: number | null = null;
  private last: Omit<FrameMetadata, "presentationTime"> | null = null;
  /** Start of the frame playback presented just before `last`. */
  private previousStart: number | null = null;
  private seekPending = false;
  private seekStartedAt = 0;
  private durations: number[] = [];
  private waiters = new Set<(mediaTime: number | null) => void>();

  static attach(video: HTMLVideoElement): VideoFrameClock | null {
    const frameVideo = video as FrameCallbackVideo;
    if (typeof frameVideo.requestVideoFrameCallback !== "function") {
      return null;
    }
    const clock = new VideoFrameClock(frameVideo);
    clock.start();
    return clock;
  }

  private constructor(private readonly video: FrameCallbackVideo) {}

  private start() {
    this.video.addEventListener("seeking", this.onSeeking);
    this.video.addEventListener("emptied", this.onEmptied);
    this.handle = this.video.requestVideoFrameCallback!(this.onFrame);
  }

  dispose() {
    if (this.handle !== null) {
      this.video.cancelVideoFrameCallback?.(this.handle);
      this.handle = null;
    }
    this.video.removeEventListener("seeking", this.onSeeking);
    this.video.removeEventListener("emptied", this.onEmptied);
    this.settleWaiters(null);
  }

  private onSeeking = (event: Event) => {
    this.seekPending = true;
    // Stamped when the seek starts, before this handler gets to run.
    this.seekStartedAt = event.timeStamp;
  };

  private onEmptied = () => {
    this.last = null;
    this.previousStart = null;
    this.durations = [];
  };

  private onFrame = (_now: number, metadata: FrameMetadata) => {
    this.handle = this.video.requestVideoFrameCallback!(this.onFrame);
    // A frame shown just before a seek can report after it starts; it still
    // shows the old position, so it mustn't settle the seek.
    if (this.seekPending && metadata.presentationTime < this.seekStartedAt) {
      return;
    }
    const previous = this.last;
    const consecutive =
      previous !== null &&
      !this.seekPending &&
      metadata.presentedFrames === previous.presentedFrames + 1;
    if (consecutive) {
      this.recordFrameSeconds(metadata.mediaTime - previous.mediaTime);
    }
    this.previousStart = consecutive ? previous.mediaTime : null;
    this.seekPending = false;
    this.last = {
      mediaTime: metadata.mediaTime,
      presentedFrames: metadata.presentedFrames,
    };
    this.settleWaiters(metadata.mediaTime);
  };

  private settleWaiters(mediaTime: number | null) {
    const waiters = [...this.waiters];
    this.waiters.clear();
    for (const resolve of waiters) resolve(mediaTime);
  }

  recordFrameSeconds(seconds: number) {
    if (!(seconds > 0) || seconds > MAX_DURATION_SAMPLE_SECONDS) return;
    this.durations.push(seconds);
    if (this.durations.length > DURATION_SAMPLES) this.durations.shift();
  }

  /**
   * Typical frame length, or null until playback or step backs have measured
   * a few frames; the median shrugs off dropped and held frames.
   */
  frameSeconds(): number | null {
    if (this.durations.length < MIN_DURATION_SAMPLES) return null;
    const sorted = [...this.durations].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  /**
   * Start of the frame on screen, in seconds. Null while a seek hasn't
   * presented its frame yet, because the last report then shows the old spot.
   */
  presentedFrameStart(): number | null {
    if (!this.last || this.seekPending || this.video.seeking) return null;
    // A frame can be presented just before its start time; anything earlier
    // than that is a report from another source or seek.
    if (this.video.currentTime < this.last.mediaTime - 0.05) return null;
    return this.last.mediaTime;
  }

  /**
   * The millisecond a comment stores for the frame on screen, or null while
   * that frame isn't known. A frame that starts less than a millisecond
   * before a cut shows at no kept millisecond, so a comment can't return to
   * it; the frame playback showed before it stands in.
   */
  presentedFrameTimeMs(cuts: readonly ExcludedRange[]): number | null {
    const start = this.presentedFrameStart();
    if (start === null) return null;
    const ms = frameTimeMs(start);
    const roundsIntoCut = cuts.some(
      (cut) => start * 1000 < cut.startMs && ms >= cut.startMs,
    );
    return roundsIntoCut && this.previousStart !== null
      ? frameTimeMs(this.previousStart)
      : ms;
  }

  /**
   * Start of the frame on screen once a seek in flight has finished.
   * Chromium presents the sought frame before it reports the seek done, so a
   * step queued straight after another must wait for both.
   */
  async settledFrameStart(): Promise<number | null> {
    if (this.video.seeking) await nextEvent(this.video, "seeked");
    if (this.seekPending) await this.nextPresentedFrame();
    return this.presentedFrameStart();
  }

  /** Media time of the next frame presented, or null if none arrives. */
  nextPresentedFrame(
    timeoutMs = PRESENTED_FRAME_TIMEOUT_MS,
  ): Promise<number | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(settle);
        resolve(null);
      }, timeoutMs);
      const settle = (mediaTime: number | null) => {
        clearTimeout(timer);
        resolve(mediaTime);
      };
      this.waiters.add(settle);
    });
  }
}

/** Resolves true when `type` fires, or false if it doesn't in time. */
function nextEvent(
  target: EventTarget,
  type: string,
  timeoutMs = PRESENTED_FRAME_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (fired: boolean) => {
      clearTimeout(timer);
      target.removeEventListener(type, onEvent);
      resolve(fired);
    };
    const onEvent = () => done(true);
    const timer = setTimeout(() => done(false), timeoutMs);
    target.addEventListener(type, onEvent);
  });
}

export interface FrameStepTarget {
  video: HTMLVideoElement;
  clock: VideoFrameClock | null;
  /** Seeks to original media time, as the player's own seek does. */
  seekMs: (ms: number) => void;
  /** Cuts in original media time, sorted and merged. */
  excludedRanges: readonly ExcludedRange[];
}

/** Another seek or playback took over the video before a step finished. */
class StepOvertaken extends Error {}

/**
 * Moves a paused video one presented frame forward or back. Resolves false
 * when it couldn't step from a frame confirmed on screen, because another
 * seek or playback took over or a seek never showed its frame, so steps
 * queued behind this one shouldn't run.
 */
export async function stepVideoFrame(
  target: FrameStepTarget,
  direction: 1 | -1,
): Promise<boolean> {
  const { video, clock, seekMs } = target;
  if (!clock) {
    // The player floors to whole milliseconds; rounding up keeps a 30 fps
    // step from landing back on the frame it started from.
    const targetMs = Math.ceil(
      (video.currentTime + direction * FALLBACK_FRAME_SECONDS) * 1000,
    );
    seekMs(
      direction < 0 ? beforeCut(targetMs, target.excludedRanges) : targetMs,
    );
    // Let each seek finish, so queued presses show every frame rather than
    // one jump.
    const fallbackSought = video.currentTime;
    const finished = !video.seeking || (await nextEvent(video, "seeked"));
    return finished && !overtaken(video, fallbackSought);
  }
  const sought = video.currentTime;
  // Stepping from the seek target instead would override a seek still in
  // flight, and a step back from mid-frame would stay on the same frame.
  const start = await clock.settledFrameStart();
  if (start === null || overtaken(video, sought)) return false;
  try {
    if (direction < 0) {
      await stepBack(target, clock, start);
    } else {
      await stepForward(target, clock, start);
    }
  } catch (error) {
    if (error instanceof StepOvertaken) return false;
    throw error;
  }
  return true;
}

function overtaken(video: HTMLVideoElement, sought: number): boolean {
  return (
    !video.paused || Math.abs(video.currentTime - sought) > SEEK_MATCH_SECONDS
  );
}

/**
 * Seeks and returns the start of the frame it shows, or null when no frame
 * arrives. Throws StepOvertaken when another seek or playback took over.
 */
async function showAt(
  { video, seekMs }: FrameStepTarget,
  clock: VideoFrameClock,
  ms: number,
): Promise<number | null> {
  seekMs(ms);
  const sought = video.currentTime;
  const shown = await clock.nextPresentedFrame();
  if (overtaken(video, sought)) throw new StepOvertaken();
  return shown;
}

/**
 * `ms`, or just before the cut it falls in: a seek into a cut skips forward
 * past it, so aiming back into one would bounce to where the step began.
 */
function beforeCut(ms: number, cuts: readonly ExcludedRange[]): number {
  const cut = cuts.find((range) => ms >= range.startMs && ms < range.endMs);
  return cut ? cut.startMs - 1 : ms;
}

async function stepBack(
  target: FrameStepTarget,
  clock: VideoFrameClock,
  start: number,
) {
  // Just before this frame starts is inside the previous one, whatever its
  // length.
  const previousMs = frameTimeMs(start) - 1;
  const targetMs = beforeCut(previousMs, target.excludedRanges);
  if (targetMs < 0) return;
  const shown = await showAt(target, clock, targetMs);
  if (targetMs === previousMs && shown !== null && shown < start) {
    clock.recordFrameSeconds(start - shown);
  }
}

async function stepForward(
  target: FrameStepTarget,
  clock: VideoFrameClock,
  start: number,
) {
  // Search the kept spans between cuts in turn: a probe inside a cut would
  // land after it and pass the frames just before it.
  let from = start;
  for (const cut of target.excludedRanges) {
    if (cut.endMs <= from * 1000) continue;
    if (cut.startMs > from * 1000) {
      const endMs = cut.startMs - 1;
      if (
        endMs > from * 1000 &&
        !(await stepWithinSpan(target, clock, start, from, endMs))
      ) {
        return;
      }
      // Nothing new shows before the cut, so the next frame is the one the
      // player shows at its end, unless the current frame lasts past it.
      const shown = await showAt(target, clock, cut.endMs);
      if (shown === null || shown > start) return;
    }
    from = cut.endMs / 1000;
  }
  await stepWithinSpan(target, clock, start, from, Number.POSITIVE_INFINITY);
}

/**
 * Steps to the first frame after `start` that shows between `from`, which
 * still shows `start`, and `endMs`. Returns true when no new frame does.
 */
async function stepWithinSpan(
  target: FrameStepTarget,
  clock: VideoFrameClock,
  start: number,
  from: number,
  endMs: number,
): Promise<boolean> {
  const learned = clock.frameSeconds();
  const frame = learned ?? FALLBACK_FRAME_SECONDS;
  // Aim just past where a frame of typical length would end. The next frame
  // shows there unless a held frame (screen recordings hold still screens)
  // covers the aim point, which the widening below handles, or two frames
  // fit before it, which takes one under about half the typical length.
  let reach = frame + 0.001;
  let lo = from;
  let next: number | null = null;
  let shownNow = start;
  for (let probe = 0; probe < MAX_FORWARD_PROBES; probe++) {
    const probeMs = Math.min(Math.round((from + reach) * 1000), endMs);
    const shown = await showAt(target, clock, probeMs);
    if (shown === null) return false;
    shownNow = shown;
    if (shown > start) {
      next = shown;
      break;
    }
    if (probeMs === endMs) return true;
    // The seek stopped short of the probe: this is the clip's last frame.
    if (target.video.currentTime * 1000 < probeMs - 1) return false;
    lo = from + reach;
    reach *= 2;
  }
  if (next === null) return false;

  // A widened probe can pass frames that follow a held one, and a guessed
  // length can pass frames shorter than the guess (60 fps); narrow back to
  // the first frame after `start`.
  for (
    let probe = 0;
    probe < MAX_NARROWING_PROBES &&
    (lo > start || learned === null) &&
    next - lo > (learned === null ? UNMEASURED_PRECISION_SECONDS : 0.5 * frame);
    probe++
  ) {
    const mid = (lo + next) / 2;
    const shown = await showAt(target, clock, Math.round(mid * 1000));
    if (shown === null) return false;
    shownNow = shown;
    if (shown > start && shown < next) next = shown;
    else lo = mid;
  }
  if (shownNow !== next) {
    await showAt(target, clock, frameTimeMs(next));
  }
  return false;
}
