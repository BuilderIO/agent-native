/**
 * Media Source Extensions loader for raw fragmented-MP4 recordings.
 *
 * Why this exists: the desktop custom recording pipeline live-streams captures
 * as fragmented MP4 with no up-front duration (`mvhd duration=0`, no `mehd`).
 * Chrome's progressive `<video src>` pipeline therefore scans the entire file
 * over the network before it can fire `loadedmetadata`, so CDN-served clips
 * spin forever. The bytes are valid and cannot be rewritten at rest (they were
 * committed to an append-only resumable upload), so instead we feed them to a
 * `MediaSource` ourselves and set the duration from the DB.
 *
 * The loader owns a `MediaSource` + one `SourceBuffer`, streams the asset with
 * sequential HTTP range requests, keeps a buffer-ahead window relative to
 * `currentTime`, realigns to fragment boundaries on seek, and evicts played
 * ranges under memory pressure. Any unrecoverable failure calls `onFatal` so
 * the caller can drop back to the plain `<video src>` path.
 *
 * Seeking reads each probed fragment's real `tfdt` timestamp rather than
 * trusting a byte-fraction estimate. These recordings are variable-bitrate, so
 * byte position and presentation time drift apart by tens of seconds over a
 * long clip; appending a fragment that starts *after* `currentTime` leaves the
 * element permanently unplayable, because MSE never jumps a forward gap on its
 * own. See `seekToTime`.
 *
 * The player component only ever sees a normal `HTMLVideoElement`; this class
 * drives it entirely through `video.src = objectUrl` + range fetches.
 */

import {
  type Mp4Track,
  findMoofOffset,
  fragmentPtsSeconds,
  parseInitSegment,
} from "./fmp4";
import { ByteTimeMap, resolveSeekFragment } from "./fmp4-seek";

const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB sequential range reads
const INIT_PROBE_SIZE = 512 * 1024; // enough to always contain ftyp+moov
const SEEK_PROBE_SIZE = 1024 * 1024; // window scanned for a moof + its tfdt
const BUFFER_AHEAD_SECONDS = 30; // download target ahead of currentTime
const BUFFER_BEHIND_SECONDS = 10; // played media kept before evicting on quota
/** Probe budget per seek. Bracketed interpolation converges in 2-3 in practice. */
const MAX_SEEK_PROBES = 6;
/**
 * How far before the seek target we accept landing. The gap is downloaded and
 * decoded before playback can resume, so a small number keeps seeks responsive;
 * landing even slightly *past* the target is never acceptable.
 */
const SEEK_ACCEPT_UNDERSHOOT_SECONDS = 4;
/** Realign retries before nudging `currentTime` into the buffer we do have. */
const MAX_REALIGN_ATTEMPTS = 3;
/** Overlap between probe steps, so a `moof` on a window boundary is not skipped. */
const PROBE_STEP_OVERLAP_BYTES = 4096;

export interface MseVideoLoaderOptions {
  /** Asset URL. Range requests go straight here (external/proxied media). */
  url: string;
  /** Authoritative duration from the DB, in milliseconds. */
  durationMs: number;
  /** The video element this loader drives. */
  video: HTMLVideoElement;
  /** Called once on any unrecoverable failure so the caller can fall back. */
  onFatal: (err: unknown) => void;
}

export function isMediaSourceSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.MediaSource !== "undefined" &&
    typeof window.MediaSource.isTypeSupported === "function"
  );
}

function parseTotalFromContentRange(header: string | null): number | null {
  if (!header) return null;
  const match = header.match(/\/(\d+)\s*$/);
  if (!match) return null;
  const total = Number.parseInt(match[1], 10);
  return Number.isFinite(total) ? total : null;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/**
 * True when a ranged request came back as a whole-file `200` for a nonzero
 * start, meaning the origin ignored `Range`. A `200` to a request starting at
 * byte 0 is just the whole asset, which lines up fine.
 */
export function rangeWasIgnored(
  status: number,
  requestedStart: number,
): boolean {
  return status === 200 && requestedStart > 0;
}

export class MseVideoLoader {
  readonly objectUrl: string;

  private readonly opts: MseVideoLoaderOptions;
  private readonly video: HTMLVideoElement;
  private readonly mediaSource: MediaSource;
  private sourceBuffer: SourceBuffer | null = null;

  private totalBytes = 0;
  /**
   * Whether we know the asset's real length. Cross-origin responses hide the
   * `Content-Range` header (it is not CORS-safelisted), so when playing a raw
   * CDN asset we cannot read the total and instead detect the end via short
   * reads. Same-origin proxied media exposes it and we use it directly.
   */
  private totalKnown = false;
  private eofReached = false;
  private initLength = 0;
  private nextOffset = 0;
  private initAppended = false;
  /** Duration (seconds) waiting to be written once the source buffer is idle. */
  private pendingDurationSec: number | null = null;
  /** Track ids and timescales from the init segment, for reading `tfdt`. */
  private tracks: Mp4Track[] = [];
  /** Observed byte<->time anchors, built as the asset is read. */
  private anchors: ByteTimeMap | null = null;
  /** Seek target waiting to be resolved by the pump, in seconds. */
  private pendingSeek: number | null = null;
  /**
   * Bumped on every `seeking` event, including one whose target is already
   * buffered. A resolve in flight for an older target must not be allowed to
   * finish and repoint the download cursor: the playhead has moved on, so the
   * cursor would end up filling a region the playhead never reaches.
   */
  private seekGeneration = 0;
  /** Target of the realigns counted by `realignAttempts`. */
  private realignTarget: number | null = null;
  private realignAttempts = 0;
  /** Start time of the most recently appended fragment, for stall detection. */
  private lastAppendSec: number | null = null;

  private destroyed = false;
  private pumping = false;
  private restart = false;
  private currentFetch: AbortController | null = null;

  constructor(opts: MseVideoLoaderOptions) {
    this.opts = opts;
    this.video = opts.video;
    this.mediaSource = new MediaSource();
    this.objectUrl = URL.createObjectURL(this.mediaSource);
    // Not `once`: after `endOfStream()` a seek into an evicted/unbuffered range
    // transitions the source back to "open" and fires `sourceopen` again, which
    // we use to resume fetching (see `onSourceOpen`).
    this.mediaSource.addEventListener("sourceopen", this.onSourceOpen);
    this.video.addEventListener("seeking", this.onSeeking);
    this.video.addEventListener("timeupdate", this.onTimeUpdate);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.currentFetch?.abort();
    this.video.removeEventListener("seeking", this.onSeeking);
    this.video.removeEventListener("timeupdate", this.onTimeUpdate);
    this.mediaSource.removeEventListener("sourceopen", this.onSourceOpen);
    this.sourceBuffer?.removeEventListener(
      "updateend",
      this.onSourceBufferIdle,
    );
    try {
      if (this.sourceBuffer && this.mediaSource.readyState === "open") {
        this.mediaSource.removeSourceBuffer(this.sourceBuffer);
      }
    } catch {
      // Removing a buffer mid-update throws; the object URL revoke below is
      // what actually tears the pipeline down.
    }
    try {
      URL.revokeObjectURL(this.objectUrl);
    } catch {
      // ignore
    }
  }

  /**
   * Update the authoritative duration after construction. Recording metadata
   * polling can deliver a later/larger value while the same asset is playing;
   * apply it to the live `MediaSource` (and the seek-estimation math) instead
   * of forcing a loader rebuild, which would revoke the object URL and restart
   * playback from byte zero.
   */
  setDuration(durationMs: number): void {
    if (this.destroyed) return;
    if (!Number.isFinite(durationMs) || durationMs <= 0) return;
    if (durationMs === this.opts.durationMs) return;
    this.opts.durationMs = durationMs;
    // Queue the timeline update and apply it as soon as the source buffer is
    // idle. Writing `mediaSource.duration` throws while an append is in flight,
    // so a value that lands mid-append must be retried on `updateend` — never
    // dropped, or the timeline stays permanently shorter than the recording.
    this.pendingDurationSec = durationMs / 1000;
    this.flushPendingDuration();
  }

  /** Apply a queued duration once the source is open and no append is running. */
  private flushPendingDuration(): void {
    if (this.destroyed || this.pendingDurationSec === null) return;
    if (this.mediaSource.readyState !== "open") return;
    if (this.sourceBuffer?.updating) return;
    try {
      this.mediaSource.duration = this.pendingDurationSec;
      this.pendingDurationSec = null;
    } catch {
      // e.g. the new duration is below the highest buffered PTS; keep it
      // queued and retry on the next `updateend`.
    }
  }

  private onSourceBufferIdle = (): void => {
    if (this.destroyed) return;
    this.flushPendingDuration();
  };

  private fail(err: unknown): void {
    if (this.destroyed) return;
    this.opts.onFatal(err);
  }

  private onSourceOpen = async (): Promise<void> => {
    if (this.destroyed) return;
    // Reopened after `endOfStream()`: a seek into an evicted/unbuffered range
    // transitions the "ended" source back to "open". The pipeline is already
    // built, so just clear the EOF latch and resume fetching for the seek
    // (`onSeeking` has set `pendingSeek`) instead of re-running init (which
    // would try to add a second source buffer).
    if (this.initAppended) {
      this.eofReached = false;
      this.schedulePump();
      return;
    }
    try {
      const durationSec = this.opts.durationMs / 1000;
      if (Number.isFinite(durationSec) && durationSec > 0) {
        // The whole point: the timeline length comes from us, never from
        // scanning the file.
        this.mediaSource.duration = durationSec;
      }

      const first = await this.fetchRange(0, INIT_PROBE_SIZE - 1);
      if (this.destroyed) return;

      const parsed = parseInitSegment(first.bytes);
      if (!parsed) throw new Error("Could not parse fMP4 init segment");
      this.initLength = parsed.initLength;
      this.tracks = parsed.tracks;
      this.anchors = new ByteTimeMap(parsed.initLength);
      if (this.tracks.length === 0) {
        // Without timescales a fragment's tfdt cannot be converted to seconds,
        // so seeking would be back to blind byte-fraction guessing. Fall back to
        // the native pipeline rather than ship a player that cannot seek.
        throw new Error("fMP4 init segment declares no readable tracks");
      }

      const mime = `video/mp4; codecs="${parsed.codecs}"`;
      if (!window.MediaSource.isTypeSupported(mime)) {
        throw new Error(`Unsupported MSE type: ${mime}`);
      }

      const sb = this.mediaSource.addSourceBuffer(mime);
      // Flush any duration update that arrived (or was deferred) while an
      // append was running.
      sb.addEventListener("updateend", this.onSourceBufferIdle);
      // "segments" mode honors each fragment's baseMediaDecodeTime, which is
      // what lets us append a later fragment after a seek without any manual
      // timestampOffset bookkeeping.
      sb.mode = "segments";
      this.sourceBuffer = sb;

      await this.appendBuffer(first.bytes.subarray(0, this.initLength));
      this.initAppended = true;

      // The 512KB probe usually also contains the first media fragments — append
      // whatever came after the init segment so playback can start immediately.
      const fetchedEnd = first.bytes.byteLength;
      if (fetchedEnd > this.initLength) {
        const media = first.bytes.subarray(this.initLength);
        const firstSec = this.recordAnchorAt(first.bytes, 0, this.initLength);
        await this.appendWithQuota(media);
        if (firstSec !== null) this.lastAppendSec = firstSec;
      }
      this.nextOffset = fetchedEnd;
      if (first.eof) this.eofReached = true;

      this.schedulePump();
    } catch (err) {
      this.fail(err);
    }
  };

  private onTimeUpdate = (): void => {
    if (this.destroyed) return;
    // Re-pump when the buffer-ahead window has drained below target.
    this.schedulePump();
  };

  private onSeeking = (): void => {
    if (this.destroyed || !this.initAppended) return;
    const target = this.video.currentTime;
    // Invalidate first, and for every seek: a target that is already buffered
    // needs no resolve of its own, but it still has to cancel one in flight.
    this.seekGeneration++;
    if (this.isBuffered(target)) {
      this.pendingSeek = null;
      // Let the pump re-check whether its download cursor still feeds this
      // playhead; the buffered range it landed in may not be the one growing.
      this.schedulePump();
      return;
    }

    // Abort any in-flight sequential fetch so we can jump.
    this.currentFetch?.abort();
    this.eofReached = false;

    if (
      this.realignTarget === null ||
      Math.abs(this.realignTarget - target) > 1
    ) {
      this.realignTarget = target;
      this.realignAttempts = 0;
    }
    this.pendingSeek = target;
    this.schedulePump();
  };

  /**
   * Record a (byte -> fragment start time) anchor for the first `moof` at or
   * after `searchFrom` within `bytes`, which was fetched from absolute offset
   * `fetchStart`. Both offsets are required: defaulting either one silently
   * files the anchor under the wrong byte position, which corrupts every later
   * seek estimate rather than failing visibly.
   *
   * Returns that fragment's start time, or null when the chunk carries no
   * readable fragment header.
   */
  private recordAnchorAt(
    bytes: Uint8Array,
    fetchStart: number,
    searchFrom: number,
  ): number | null {
    const moof = findMoofOffset(bytes.subarray(searchFrom));
    if (moof < 0) return null;
    const at = searchFrom + moof;
    const sec = fragmentPtsSeconds(bytes, at, this.tracks);
    if (sec === null) return null;
    this.anchors?.add(fetchStart + at, sec);
    return sec;
  }

  private schedulePump(): void {
    if (this.pumping) {
      this.restart = true;
      return;
    }
    void this.runPump();
  }

  private async runPump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (
        !this.destroyed &&
        this.sourceBuffer &&
        this.mediaSource.readyState === "open"
      ) {
        if (this.pendingSeek !== null) {
          const target = this.pendingSeek;
          this.pendingSeek = null;
          const resolved = await this.seekToTime(target);
          if (this.destroyed) break;
          if (!resolved) break;
          continue;
        }

        if (
          this.eofReached ||
          (this.totalKnown && this.nextOffset >= this.totalBytes)
        ) {
          this.tryEndOfStream();
          break;
        }

        // We are filling media the playhead cannot reach. Downloading further
        // only widens the gap, so realign to the playhead instead of quietly
        // streaming to EOF behind a spinner.
        if (this.downloadIsDisjoint()) {
          if (this.requestRealign(this.video.currentTime)) continue;
          break;
        }

        // Stop downloading once we're comfortably ahead.
        if (this.bufferedAhead() >= BUFFER_AHEAD_SECONDS) break;

        const chunkStart = this.nextOffset;
        const chunkEnd = this.totalKnown
          ? Math.min(chunkStart + CHUNK_SIZE, this.totalBytes) - 1
          : chunkStart + CHUNK_SIZE - 1;

        let res: { bytes: Uint8Array; eof: boolean };
        try {
          res = await this.fetchRange(chunkStart, chunkEnd);
        } catch (err) {
          if (isAbortError(err)) break; // superseded by a seek
          throw err;
        }
        if (this.destroyed) break;
        if (res.bytes.byteLength === 0) {
          this.eofReached = true;
          this.tryEndOfStream();
          break;
        }

        const chunkSec = this.recordAnchorAt(res.bytes, chunkStart, 0);
        await this.appendWithQuota(res.bytes);
        if (chunkSec !== null) this.lastAppendSec = chunkSec;
        this.nextOffset = chunkStart + res.bytes.byteLength;
        if (res.eof) this.eofReached = true;
      }
    } catch (err) {
      this.fail(err);
    } finally {
      this.pumping = false;
      if (this.restart && !this.destroyed) {
        this.restart = false;
        this.schedulePump();
      }
    }
  }

  private abortParser(): void {
    const sb = this.sourceBuffer;
    if (!sb || this.mediaSource.readyState !== "open" || sb.updating) return;
    try {
      sb.abort();
    } catch {
      // abort() is best-effort; a failure here just means the next append may
      // still be treated as a continuation.
    }
  }

  private tryEndOfStream(): void {
    if (this.mediaSource.readyState !== "open") return;
    if (this.sourceBuffer?.updating) return;
    try {
      this.mediaSource.endOfStream();
    } catch {
      // Duration is already correct from the DB; endOfStream is best-effort.
    }
  }

  private bufferedAhead(): number {
    const buffered = this.sourceBuffer?.buffered;
    if (!buffered || buffered.length === 0) return 0;
    const t = this.video.currentTime;
    for (let i = 0; i < buffered.length; i++) {
      const start = buffered.start(i);
      const end = buffered.end(i);
      if (t >= start - 0.25 && t <= end) return end - t;
    }
    return 0;
  }

  private estimateByteOffset(targetSec: number): number {
    if (!this.anchors) return this.initLength;
    return this.anchors.estimate(targetSec, {
      totalBytes: this.totalKnown ? this.totalBytes : null,
      durationSec: this.opts.durationMs / 1000,
    });
  }

  private clampProbeStart(byte: number): number {
    const floor = Math.max(this.initLength, Math.floor(byte));
    if (!this.totalKnown) return floor;
    return Math.min(
      floor,
      Math.max(this.initLength, this.totalBytes - SEEK_PROBE_SIZE),
    );
  }

  /**
   * Fetch a window at `startByte` and return the first fragment in it whose
   * timestamp is readable, walking forward a couple of windows when a fragment
   * is larger than one probe. Records the (byte -> time) pair as an anchor.
   */
  private async probeFragmentAt(startByte: number): Promise<{
    fetchStart: number;
    bytes: Uint8Array;
    moof: number;
    byte: number;
    sec: number;
  } | null> {
    let start = this.clampProbeStart(startByte);
    for (let step = 0; step < 3; step++) {
      const end = this.totalKnown
        ? Math.min(start + SEEK_PROBE_SIZE, this.totalBytes) - 1
        : start + SEEK_PROBE_SIZE - 1;
      const res = await this.fetchRange(start, end);
      if (this.destroyed || res.bytes.byteLength === 0) return null;

      const moof = findMoofOffset(res.bytes);
      if (moof >= 0) {
        const sec = fragmentPtsSeconds(res.bytes, moof, this.tracks);
        if (sec !== null) {
          this.anchors?.add(start + moof, sec);
          return {
            fetchStart: start,
            bytes: res.bytes,
            moof,
            byte: start + moof,
            sec,
          };
        }
      }
      if (res.eof) return null;
      // Overlap the step: a `moof` header straddling the window boundary is
      // unreadable in this window, and stepping the full width would skip past
      // that fragment entirely.
      start += Math.max(1, res.bytes.byteLength - PROBE_STEP_OVERLAP_BYTES);
    }
    return null;
  }

  /**
   * Resolve a seek by reading real fragment timestamps (see `fmp4-seek`),
   * append from the fragment it picks, and leave the sequential pump to fill
   * forward from there.
   *
   * Returns false when the pump should stop (destroyed, or reported fatal).
   */
  private async seekToTime(target: number): Promise<boolean> {
    const generation = this.seekGeneration;
    let resolution;
    try {
      resolution = await resolveSeekFragment({
        target,
        initLength: this.initLength,
        probeSize: SEEK_PROBE_SIZE,
        maxProbes: MAX_SEEK_PROBES,
        acceptUndershootSeconds: SEEK_ACCEPT_UNDERSHOOT_SECONDS,
        estimate: () => this.estimateByteOffset(target),
        probe: (startByte) => this.probeFragmentAt(startByte),
        superseded: () =>
          this.destroyed ||
          this.pendingSeek !== null ||
          this.seekGeneration !== generation,
      });
    } catch (err) {
      if (isAbortError(err)) return !this.destroyed; // superseded by a new seek
      throw err;
    }
    if (this.destroyed) return false;
    // A newer seek arrived; the pump loop picks it up on the next iteration.
    // Checked again here because the resolve may have completed in the same
    // tick the new seek arrived — appending now would aim the download cursor
    // at a target the viewer has already left.
    if (resolution.superseded || this.seekGeneration !== generation)
      return true;

    const chosen = resolution.chosen;
    if (!chosen) {
      this.fail(
        new Error(`No fMP4 fragment found for a seek to ${target.toFixed(2)}s`),
      );
      return false;
    }

    this.eofReached = false;
    // Reset the segment parser so it drops any partial fragment left over from
    // the aborted sequential append and treats these bytes as a fresh media
    // segment. Without this, appending a fragment from a new byte position
    // fails with CHUNK_DEMUXER_ERROR_APPEND_FAILED.
    this.abortParser();
    await this.appendWithQuota(chosen.bytes.subarray(chosen.moof));
    this.lastAppendSec = chosen.sec;
    this.nextOffset = chosen.fetchStart + chosen.bytes.byteLength;

    if (resolution.overshot) {
      // Every probe landed past the target — a target beyond the last fragment,
      // or a tail we cannot parse. Move the playhead onto media we actually
      // hold instead of leaving it on a position that will never arrive.
      this.nudgeCurrentTimeTo(chosen.sec);
      return true;
    }

    // A resolved seek clears the realign budget: the next stall, if any, is a
    // new problem and deserves its own retries.
    this.realignTarget = null;
    this.realignAttempts = 0;
    return true;
  }

  /**
   * True when the download cursor is filling media the playhead cannot reach:
   * either the playhead has nothing buffered at all, or it sits in a range that
   * we are not extending, so that range will run out with nothing behind it.
   *
   * Checking only "playhead unbuffered" is not enough. After a seek back into
   * an already-buffered stretch, the playhead is buffered while the cursor is
   * still filling somewhere else entirely — playback then runs to the end of
   * its own range and stops, which looks exactly like the stall this loader
   * exists to prevent.
   */
  private downloadIsDisjoint(): boolean {
    if (this.lastAppendSec === null) return false;
    const t = this.video.currentTime;
    const end = this.bufferedEndAt(t);
    if (end === null) return true; // nothing buffered at the playhead
    return this.lastAppendSec > end + 1;
  }

  /** End of the buffered range containing `time`, or null when unbuffered. */
  private bufferedEndAt(time: number): number | null {
    const buffered = this.sourceBuffer?.buffered;
    if (!buffered) return null;
    for (let i = 0; i < buffered.length; i++) {
      if (time >= buffered.start(i) - 0.25 && time <= buffered.end(i)) {
        return buffered.end(i);
      }
    }
    return null;
  }

  /**
   * Queue another seek resolution for `target`. Returns false once the retry
   * budget is spent, having either moved the playhead onto media we hold or
   * reported a fatal — never leaving the pump stopped with the playhead parked
   * on an unreachable position and no pending work to fix it.
   */
  private requestRealign(target: number): boolean {
    if (
      this.realignTarget === null ||
      Math.abs(this.realignTarget - target) > 1
    ) {
      this.realignTarget = target;
      this.realignAttempts = 0;
    }
    if (this.realignAttempts >= MAX_REALIGN_ATTEMPTS) {
      const start = this.firstBufferedStartAfter(target);
      if (start === null) {
        this.fail(
          new Error(
            `Playback stalled at ${target.toFixed(2)}s with no buffered media to resume from`,
          ),
        );
      } else {
        this.nudgeCurrentTimeTo(start);
      }
      return false;
    }
    this.realignAttempts++;
    this.pendingSeek = target;
    return true;
  }

  private firstBufferedStartAfter(time: number): number | null {
    const buffered = this.sourceBuffer?.buffered;
    if (!buffered) return null;
    for (let i = 0; i < buffered.length; i++) {
      if (buffered.start(i) > time) return buffered.start(i);
    }
    return null;
  }

  /**
   * Move the playhead onto buffered media. The resulting `seeking` event finds
   * the position already buffered and returns early, so this cannot re-enter
   * the seek resolver.
   */
  private nudgeCurrentTimeTo(sec: number): void {
    if (!Number.isFinite(sec) || sec < 0) {
      this.fail(new Error(`Cannot nudge the playhead to ${sec}`));
      return;
    }
    try {
      this.video.currentTime = sec + 0.05;
    } catch (err) {
      // Terminal safety net: without the nudge the element stays parked on an
      // unreachable time, which is the stall this path exists to prevent.
      // Report so the caller drops back to the native `<video src>` pipeline.
      this.fail(err);
    }
  }

  private isBuffered(time: number): boolean {
    const buffered = this.sourceBuffer?.buffered;
    if (!buffered) return false;
    for (let i = 0; i < buffered.length; i++) {
      if (time >= buffered.start(i) - 0.25 && time <= buffered.end(i)) {
        return true;
      }
    }
    return false;
  }

  private appendBuffer(bytes: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      const sb = this.sourceBuffer;
      if (!sb) {
        reject(new Error("No source buffer"));
        return;
      }
      const onEnd = () => {
        cleanup();
        resolve();
      };
      const onErr = () => {
        cleanup();
        reject(new Error("SourceBuffer append error"));
      };
      const cleanup = () => {
        sb.removeEventListener("updateend", onEnd);
        sb.removeEventListener("error", onErr);
      };
      sb.addEventListener("updateend", onEnd);
      sb.addEventListener("error", onErr);
      try {
        sb.appendBuffer(bytes as BufferSource);
      } catch (err) {
        cleanup();
        reject(err);
      }
    });
  }

  private async appendWithQuota(bytes: Uint8Array): Promise<void> {
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        await this.appendBuffer(bytes);
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "QuotaExceededError") {
          const freed = await this.evictBehind();
          if (!freed) throw err;
          continue;
        }
        throw err;
      }
    }
    throw new Error("SourceBuffer quota could not be reclaimed");
  }

  private async evictBehind(): Promise<boolean> {
    const sb = this.sourceBuffer;
    if (!sb || sb.buffered.length === 0) return false;
    const removeEnd = this.video.currentTime - BUFFER_BEHIND_SECONDS;
    const start = sb.buffered.start(0);
    if (removeEnd <= start) return false;
    await this.remove(start, removeEnd);
    return true;
  }

  private remove(start: number, end: number): Promise<void> {
    return new Promise((resolve) => {
      const sb = this.sourceBuffer;
      if (!sb) {
        resolve();
        return;
      }
      const onEnd = () => {
        sb.removeEventListener("updateend", onEnd);
        resolve();
      };
      sb.addEventListener("updateend", onEnd);
      try {
        sb.remove(start, end);
      } catch {
        sb.removeEventListener("updateend", onEnd);
        resolve();
      }
    });
  }

  private async fetchRange(
    start: number,
    end: number,
  ): Promise<{ bytes: Uint8Array; eof: boolean }> {
    const controller = new AbortController();
    this.currentFetch = controller;
    const res = await fetch(this.opts.url, {
      headers: { Range: `bytes=${start}-${end}` },
      signal: controller.signal,
    });
    if (res.status === 416) {
      // A 416 at an offset before the known file total means the backing object
      // was replaced with a smaller compressed version while we were streaming.
      // Throw so runPump's catch calls fail() -> onFatal -> native path recovery.
      // When totalKnown is false (cross-origin CDN hides Content-Range), we
      // cannot tell premature from real EOF so we keep the old safe-EOF behaviour.
      if (this.totalKnown && start < this.totalBytes) {
        throw new Error("Range 416 before known EOF: backing file replaced");
      }
      return { bytes: new Uint8Array(0), eof: true };
    }
    if (!res.ok) {
      throw new Error(`Range request failed: ${res.status}`);
    }
    if (rangeWasIgnored(res.status, start)) {
      // A 200 to a ranged request is the whole file, so its bytes start at 0 —
      // not at `start`. Reading it as though they lined up files every anchor
      // and the resume offset under the wrong byte position, poisoning later
      // seeks. An origin that ignores Range also defeats the point of this
      // loader (each 2MB window would pull the entire asset), so hand back to
      // the native pipeline instead of trying to compensate.
      throw new Error("Origin ignored the Range header; cannot stream windows");
    }
    // If the backing file shrank mid-response (ERR_CONTENT_LENGTH_MISMATCH),
    // arrayBuffer() throws here, which also routes through fail() -> onFatal.
    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Learn the real total when the header is readable (same-origin proxied
    // media). Cross-origin CDN responses hide Content-Range, so we fall back to
    // short-read detection below.
    const total = parseTotalFromContentRange(res.headers.get("content-range"));
    if (total != null && total > 0) {
      this.totalBytes = total;
      this.totalKnown = true;
    }

    const requested = end - start + 1;
    // A 200 (only reachable from a start of 0, per the guard above, so it is
    // the whole asset) or a short 206 both mean this response ran to the end.
    const eof =
      res.status === 200 ||
      bytes.byteLength < requested ||
      (this.totalKnown && start + bytes.byteLength >= this.totalBytes);

    return { bytes, eof };
  }
}
