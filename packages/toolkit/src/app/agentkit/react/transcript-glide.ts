/** Angular frequency of the follow spring; it settles a line's step in ~160ms. */
const TRANSCRIPT_GLIDE_FREQUENCY = 28;
const SETTLED_DISTANCE_PX = 0.5;
const SETTLED_VELOCITY_PX_PER_SECOND = 8;
const MAX_FRAME_DELTA_MS = 64;
/** Browsers round scroll offsets; a larger move than this came from elsewhere. */
const FOREIGN_SCROLL_TOLERANCE_PX = 1.5;

export interface TranscriptGlideElement {
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

export interface TranscriptGlideOptions {
  element: TranscriptGlideElement;
  /** Writes a scroll offset the scroll handler will recognise as its own. */
  write: (scrollTop: number) => void;
  /** Checked every frame; the glide stops as soon as it returns false. */
  following: () => boolean;
  requestFrame?: (callback: (time: number) => void) => number;
  cancelFrame?: (handle: number) => void;
}

/**
 * Moves a scroller to its bottom with a critically damped spring, retargeting
 * every frame as content grows, so a wrapped line slides into view instead of
 * shifting the transcript in one frame. It never fights the reader: when the
 * offset moved by anything other than its own write, or `following` turns
 * false, it stops without writing.
 */
export class TranscriptGlide {
  private position = 0;
  private velocity = 0;
  private written: number | null = null;
  private lastTime: number | null = null;
  private frame: number | null = null;
  private readonly requestFrame: (callback: (time: number) => void) => number;
  private readonly cancelFrame: (handle: number) => void;

  constructor(private readonly options: TranscriptGlideOptions) {
    this.requestFrame =
      options.requestFrame ?? ((callback) => requestAnimationFrame(callback));
    this.cancelFrame =
      options.cancelFrame ?? ((handle) => cancelAnimationFrame(handle));
  }

  get active(): boolean {
    return this.frame !== null;
  }

  /** Starts gliding toward the bottom, or keeps a running glide going. */
  follow(): void {
    if (this.frame !== null) return;
    this.position = this.options.element.scrollTop;
    this.velocity = 0;
    this.written = null;
    this.lastTime = null;
    this.frame = this.requestFrame(this.tick);
  }

  stop(): void {
    if (this.frame !== null) this.cancelFrame(this.frame);
    this.frame = null;
    this.velocity = 0;
    this.written = null;
  }

  private readonly tick = (time: number): void => {
    this.frame = null;
    const { element } = this.options;
    if (!this.options.following()) {
      this.stop();
      return;
    }
    if (
      this.written !== null &&
      Math.abs(element.scrollTop - this.written) > FOREIGN_SCROLL_TOLERANCE_PX
    ) {
      // The reader (or another write) moved the view; leave it to them.
      this.stop();
      return;
    }
    const target = Math.max(0, element.scrollHeight - element.clientHeight);
    const elapsed =
      this.lastTime === null
        ? 1000 / 60
        : Math.min(MAX_FRAME_DELTA_MS, Math.max(0, time - this.lastTime));
    this.lastTime = time;

    const seconds = elapsed / 1000;
    const omega = TRANSCRIPT_GLIDE_FREQUENCY;
    const offset = this.position - target;
    const decay = Math.exp(-omega * seconds);
    const blend = this.velocity + omega * offset;
    const nextOffset = (offset + blend * seconds) * decay;
    this.velocity = (this.velocity - omega * blend * seconds) * decay;
    this.position = target + nextOffset;

    const settled =
      Math.abs(nextOffset) < SETTLED_DISTANCE_PX &&
      Math.abs(this.velocity) < SETTLED_VELOCITY_PX_PER_SECOND;
    if (settled) this.position = target;
    this.options.write(this.position);
    this.written = element.scrollTop;
    if (settled) {
      this.velocity = 0;
      this.written = null;
      return;
    }
    this.frame = this.requestFrame(this.tick);
  };
}
