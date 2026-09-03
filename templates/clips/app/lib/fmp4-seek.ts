/**
 * Seek policy for the fragmented-MP4 MSE player: given a target time, decide
 * which byte offset to start appending from.
 *
 * Split out from `MseVideoLoader` so the decision-making is pure and testable
 * without a `MediaSource`. The loader owns the transport (range requests,
 * source buffer); this owns the one rule that matters:
 *
 *   never start appending at a fragment that begins AFTER the seek target.
 *
 * MSE does not jump a forward gap, so a fragment that starts even 80ms past the
 * playhead is not an approximate seek — the element waits for media that will
 * never be appended, and the viewer sees a spinner forever.
 *
 * These recordings are strongly variable-bitrate (a static screen costs almost
 * nothing, motion costs a lot), so a byte-fraction estimate drifts from the
 * real timeline by tens of seconds over a long clip, in whichever direction the
 * earlier part of the clip is quieter or busier than average. The only reliable
 * answer comes from reading fragment timestamps, which is what this does.
 */

export interface FragmentLocation {
  /** Byte offset of the fragment's `moof` box. */
  byte: number;
  /** Presentation time the fragment starts at, in seconds. */
  sec: number;
}

/** Minimum time span between two anchors used to derive a bitrate. */
const MIN_SLOPE_SPAN_SECONDS = 0.5;

export interface EstimateBounds {
  /**
   * Asset length, or null when it is unknown — cross-origin responses hide
   * `Content-Range`, so there is no end-of-file anchor to work against.
   */
  totalBytes: number | null;
  durationSec: number;
}

/**
 * Observed (byte offset -> fragment start time) pairs, used to interpolate a
 * probe position. Every probe adds one, so the map sharpens as a viewer scrubs
 * and later seeks converge in fewer round trips.
 */
export class ByteTimeMap {
  private readonly anchors: FragmentLocation[] = [];

  constructor(private readonly initLength: number) {}

  get size(): number {
    return this.anchors.length;
  }

  add(byte: number, sec: number): void {
    if (!Number.isFinite(byte) || !Number.isFinite(sec)) return;
    if (byte < this.initLength || sec < 0) return;
    const existing = this.anchors.findIndex((a) => a.byte === byte);
    if (existing >= 0) {
      this.anchors[existing] = { byte, sec };
      return;
    }
    this.anchors.push({ byte, sec });
    this.anchors.sort((a, b) => a.byte - b.byte);
  }

  /**
   * Byte offset to probe for `targetSec`, from the local bitrate around it.
   *
   * The two anchors nearest the target in time define the line, whether they
   * straddle the target or both sit on one side of it. Anchoring on the start
   * of the file instead — the obvious choice — converges badly here: the line
   * from t=0 to a point past the target carries the clip's *average* bitrate,
   * which in a screen recording can be half the local one, so each correction
   * only covers part of the remaining distance and a seek burns several round
   * trips walking in.
   */
  estimate(targetSec: number, bounds: EstimateBounds): number {
    const points = this.referencePoints(bounds);
    const byDistance = points
      .slice()
      .sort(
        (a, b) =>
          Math.abs(a.sec - targetSec) - Math.abs(b.sec - targetSec) ||
          a.byte - b.byte,
      );

    const near = byDistance[0];
    const far = near
      ? byDistance.find(
          (p) =>
            p.byte !== near.byte &&
            Math.abs(p.sec - near.sec) >= MIN_SLOPE_SPAN_SECONDS,
        )
      : undefined;
    if (!near || !far) return this.initLength;

    const slope = (far.byte - near.byte) / (far.sec - near.sec);
    if (!(slope > 0)) return this.initLength;
    return this.clampByte(near.byte + (targetSec - near.sec) * slope, bounds);
  }

  /** Anchors plus the two synthetic endpoints, deduplicated by byte offset. */
  private referencePoints(bounds: EstimateBounds): FragmentLocation[] {
    const points: FragmentLocation[] = [{ byte: this.initLength, sec: 0 }];
    for (const anchor of this.anchors) {
      if (anchor.byte !== this.initLength) points.push(anchor);
    }
    if (
      bounds.totalBytes !== null &&
      bounds.durationSec > 0 &&
      bounds.totalBytes > this.initLength &&
      !points.some((p) => p.byte === bounds.totalBytes)
    ) {
      points.push({ byte: bounds.totalBytes, sec: bounds.durationSec });
    }
    return points;
  }

  private clampByte(byte: number, bounds: EstimateBounds): number {
    const floored = Math.max(this.initLength, Math.floor(byte));
    if (bounds.totalBytes === null) return floored;
    return Math.min(floored, Math.max(this.initLength, bounds.totalBytes - 1));
  }
}

export interface ResolveSeekOptions<T extends FragmentLocation> {
  /** Seek target in seconds. */
  target: number;
  /** Byte offset of the first media fragment; nothing earlier is probeable. */
  initLength: number;
  /** Size of one probe window in bytes. */
  probeSize: number;
  /** Probe budget. Bracketed interpolation converges in 2-3 in practice. */
  maxProbes: number;
  /**
   * How far before the target we accept landing. The gap must be downloaded
   * before playback resumes, so a small number keeps seeks responsive.
   */
  acceptUndershootSeconds: number;
  /** Byte offset to try next, from the anchors learned so far. */
  estimate: () => number;
  /** Read the first usable fragment at or after `startByte`, or null. */
  probe: (startByte: number) => Promise<T | null>;
  /** Abandon early — a newer seek has superseded this one. */
  superseded?: () => boolean;
}

export interface ResolvedSeek<T> {
  /** Fragment to append from, or null when none could be located. */
  chosen: T | null;
  /**
   * True when `chosen` starts after `target`, so appending it alone leaves the
   * playhead on an unreachable position and the caller must move the playhead.
   */
  overshot: boolean;
  probes: number;
  superseded: boolean;
}

/**
 * Locate the fragment to start appending from for a seek to `target`.
 *
 * Probes, compares the fragment's real start time against the target, and
 * re-estimates with each new anchor until it lands at or just before the
 * target, maintaining a byte bracket so every probe makes progress:
 *
 *   - `probe` returns the FIRST fragment at or after the position asked for, so
 *     an overshoot proves no fragment begins in `[probed, fragment)`. The bound
 *     is therefore the position probed, not the fragment's own offset — that is
 *     what makes the bracket narrow instead of sitting still while the forward
 *     scan keeps returning the same fragment.
 *   - Inside a bracket, the probe goes to whichever is further back: the
 *     estimate, or a doubling step below the bound. Neither works alone — the
 *     estimate typically misses by less than one fragment so the bracket only
 *     creeps, while a blind stride cannot be sized (doubling past one oversized
 *     fragment walks back to the start of the file). Once a step would pass the
 *     far end it bisects, and once the bracket is about one window wide it
 *     probes the floor, the earliest fragment still reachable.
 *   - With no upper bound yet and an estimate that cannot move (a single
 *     anchor at t=0, or a duration that understates the clip), the probe
 *     gallops forward at a doubling stride rather than re-probing one spot
 *     until the budget is gone.
 */
export async function resolveSeekFragment<T extends FragmentLocation>(
  opts: ResolveSeekOptions<T>,
): Promise<ResolvedSeek<T>> {
  const { target, initLength, probeSize, maxProbes } = opts;
  let landed: T | null = null;
  let overshoot: T | null = null;
  /** Highest byte known to hold a fragment at or before `target`. */
  let lowerByte = initLength;
  /** Lowest byte known to hold nothing usable at or before `target`. */
  let upperByte: number | null = null;
  let forwardStep = probeSize;
  let backStep = probeSize;
  let lastStart: number | null = null;
  let probes = 0;

  for (let attempt = 0; attempt < maxProbes; attempt++) {
    if (opts.superseded?.()) {
      return { chosen: null, overshot: false, probes, superseded: true };
    }

    // Bias slightly early: `probe` scans forward to the next fragment, so
    // starting a little before the estimated point usually lands under the
    // target on the first probe instead of the second. The bias is a nudge, not
    // evidence — the forward-gallop decision below reads the unbiased estimate,
    // because a bias that dips under the floor must not be mistaken for "the
    // estimate cannot move forward" and skip an answer sitting at the floor.
    const estimated = opts.estimate();
    let guess = estimated - Math.floor(probeSize / 2);
    if (upperByte !== null) {
      // Below a known bound, take whichever is further back: the estimate, or a
      // doubling step. The estimate carries a large correction in one hop, but
      // on its own it stalls — it typically misses by a fraction of a second,
      // which is less than one fragment, so the forward scan keeps returning
      // the same fragment and the bracket creeps. The doubling step guarantees
      // each probe clears at least one fragment.
      const ceiling = upperByte - backStep;
      backStep *= 2;
      guess = Math.min(guess, ceiling);
      if (guess <= lowerByte) {
        // Once the bracket is down to about one window, its floor is the most
        // informative position left: a forward scan from there returns the
        // earliest fragment in the bracket. Above that, bisect.
        guess =
          upperByte - lowerByte <= probeSize
            ? lowerByte
            : Math.floor((lowerByte + upperByte) / 2);
      }
    } else if (estimated <= lowerByte) {
      guess = lowerByte + forwardStep;
      forwardStep *= 2;
    }

    const start = Math.max(Math.floor(guess), initLength);
    if (upperByte !== null && start >= upperByte) break;
    // No new information is available from a position already probed.
    if (start === lastStart) break;
    lastStart = start;

    probes++;
    const candidate = await opts.probe(start);

    if (!candidate) {
      // Nothing usable from here to the end of the asset — past EOF, or an
      // unparseable tail. Bound and keep looking earlier rather than
      // abandoning the seek, which would strand a viewer whose target is
      // perfectly playable.
      if (upperByte === null || start < upperByte) upperByte = start;
      if (upperByte <= initLength) break;
      continue;
    }

    if (candidate.sec <= target) {
      if (!landed || candidate.sec > landed.sec) landed = candidate;
      if (candidate.byte > lowerByte) lowerByte = candidate.byte;
      if (target - candidate.sec <= opts.acceptUndershootSeconds) break;
      continue; // undershot too far; the fresh anchor sharpens the next guess
    }

    if (!overshoot || candidate.byte < overshoot.byte) overshoot = candidate;
    if (upperByte === null || start < upperByte) upperByte = start;
  }

  const chosen = landed ?? overshoot;
  return {
    chosen,
    overshot: chosen !== null && landed === null,
    probes,
    superseded: false,
  };
}
