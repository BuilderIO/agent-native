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
 * The player component only ever sees a normal `HTMLVideoElement`; this class
 * drives it entirely through `video.src = objectUrl` + range fetches.
 */

import { findMoofOffset, parseInitSegment } from "./fmp4";

const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB sequential range reads
const INIT_PROBE_SIZE = 512 * 1024; // enough to always contain ftyp+moov
const SEEK_PROBE_SIZE = 4 * 1024 * 1024; // window scanned for a moof after seek
const BUFFER_AHEAD_SECONDS = 30; // download target ahead of currentTime
const BUFFER_BEHIND_SECONDS = 10; // played media kept before evicting on quota
const SEEK_BACKOFF_BYTES = 512 * 1024; // land a little early so we don't overshoot

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
  private needsRealign = false;
  /** Duration (seconds) waiting to be written once the source buffer is idle. */
  private pendingDurationSec: number | null = null;
  /**
   * Byte offset the current realign probe started from (the seek estimate,
   * then walked backward by `backUpRealignProbe`). Used to recover when a seek
   * estimate overshoots past the target fragment's `moof` into its `mdat`.
   */
  private realignProbeStart = 0;
  /** Media bytes appended so far (excludes the init segment). */
  private mediaBytesAppended = 0;

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
    // (`onSeeking` has set `needsRealign`/`nextOffset`) instead of re-running
    // init (which would try to add a second source buffer).
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
        await this.appendWithQuota(media);
        this.mediaBytesAppended += media.byteLength;
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
    if (this.isBuffered(target)) return; // already have this position

    // Abort any in-flight sequential fetch so we can jump.
    this.currentFetch?.abort();
    this.eofReached = false;

    this.nextOffset = Math.max(
      this.initLength,
      this.estimateByteOffset(target),
    );
    this.realignProbeStart = this.nextOffset;
    this.needsRealign = true;
    this.schedulePump();
  };

  /**
   * Recover a seek whose estimate overshot past the target fragment's `moof`
   * into its `mdat`. That can only happen inside the FINAL fragment (every
   * earlier one is followed by another `moof`), so a forward scan reaches EOF
   * with no boundary. Back the probe window up by one `SEEK_PROBE_SIZE`
   * (floored at the init segment) and re-scan, instead of treating EOF as a
   * completed seek and stalling. Returns false when there is nothing earlier
   * left to probe.
   */
  private backUpRealignProbe(): boolean {
    if (this.realignProbeStart <= this.initLength) return false;
    this.realignProbeStart = Math.max(
      this.initLength,
      this.realignProbeStart - SEEK_PROBE_SIZE,
    );
    this.nextOffset = this.realignProbeStart;
    this.eofReached = false;
    return true;
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
        if (
          this.eofReached ||
          (this.totalKnown && this.nextOffset >= this.totalBytes)
        ) {
          // A realign that reached EOF without finding its boundary overshot
          // into the final fragment — back up and keep looking before ending.
          if (this.needsRealign && this.backUpRealignProbe()) {
            continue;
          }
          this.needsRealign = false;
          this.tryEndOfStream();
          break;
        }
        // Stop downloading once we're comfortably ahead — unless we still need
        // to realign to a fragment boundary after a seek.
        if (
          !this.needsRealign &&
          this.bufferedAhead() >= BUFFER_AHEAD_SECONDS
        ) {
          break;
        }

        const chunkStart = this.nextOffset;
        const windowSize = this.needsRealign ? SEEK_PROBE_SIZE : CHUNK_SIZE;
        const chunkEnd = this.totalKnown
          ? Math.min(chunkStart + windowSize, this.totalBytes) - 1
          : chunkStart + windowSize - 1;

        let res: { bytes: Uint8Array; eof: boolean };
        try {
          res = await this.fetchRange(chunkStart, chunkEnd);
        } catch (err) {
          if (isAbortError(err)) break; // superseded by a seek
          throw err;
        }
        if (this.destroyed) break;
        if (res.bytes.byteLength === 0) {
          if (this.needsRealign && this.backUpRealignProbe()) {
            continue;
          }
          this.eofReached = true;
          this.tryEndOfStream();
          break;
        }

        let bytes = res.bytes;
        if (this.needsRealign) {
          const moof = findMoofOffset(bytes);
          if (moof < 0) {
            if (res.eof) {
              // Reached EOF with no boundary — the estimate overshot into the
              // final fragment's mdat. Back up and re-probe rather than
              // stalling the seek; give up only once nothing earlier remains.
              if (this.backUpRealignProbe()) {
                continue;
              }
              this.needsRealign = false;
              this.eofReached = true;
              this.tryEndOfStream();
              break;
            }
            // No fragment boundary in this window — advance and keep scanning.
            this.nextOffset = chunkStart + bytes.byteLength;
            continue;
          }
          bytes = bytes.subarray(moof);
          this.nextOffset = chunkStart + moof;
          this.needsRealign = false;
          // Reset the segment parser so it drops any partial fragment left over
          // from the aborted sequential append and treats these bytes as a
          // fresh media segment. Without this, appending a fragment from a new
          // byte position fails with CHUNK_DEMUXER_ERROR_APPEND_FAILED.
          this.abortParser();
        }

        await this.appendWithQuota(bytes);
        this.mediaBytesAppended += bytes.byteLength;
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

  /** Highest buffered presentation time — how far into the media we've decoded. */
  private bufferedSeconds(): number {
    const buffered = this.sourceBuffer?.buffered;
    if (!buffered || buffered.length === 0) return 0;
    return buffered.end(buffered.length - 1);
  }

  /**
   * Estimate the byte offset for a seek target. Uses the known total when we
   * have it, otherwise the observed average bitrate (bytes of media appended per
   * second buffered). Lands `SEEK_BACKOFF_BYTES` early so we don't overshoot the
   * target fragment; the caller realigns forward to the next `moof`.
   */
  private estimateByteOffset(targetSec: number): number {
    const durationSec = this.opts.durationMs / 1000;
    if (this.totalKnown && durationSec > 0) {
      const frac = Math.min(Math.max(targetSec / durationSec, 0), 1);
      return Math.floor(this.totalBytes * frac) - SEEK_BACKOFF_BYTES;
    }
    const bufferedSec = this.bufferedSeconds();
    if (bufferedSec > 0 && this.mediaBytesAppended > 0) {
      const bytesPerSec = this.mediaBytesAppended / bufferedSec;
      return (
        Math.floor(this.initLength + targetSec * bytesPerSec) -
        SEEK_BACKOFF_BYTES
      );
    }
    return this.initLength;
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
    // 416 means we asked past the end — treat as a clean end-of-stream.
    if (res.status === 416) return { bytes: new Uint8Array(0), eof: true };
    if (!res.ok) {
      throw new Error(`Range request failed: ${res.status}`);
    }
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
    // A 200 (server ignored Range) or a short 206 both mean this response ran to
    // the end of the asset.
    const eof =
      res.status === 200 ||
      bytes.byteLength < requested ||
      (this.totalKnown && start + bytes.byteLength >= this.totalBytes);

    return { bytes, eof };
  }
}
