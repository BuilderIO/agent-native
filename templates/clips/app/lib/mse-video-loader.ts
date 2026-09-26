import {
  type Mp4Track,
  findMoofOffset,
  fragmentPtsSeconds,
  parseInitSegment,
} from "./fmp4";
import { ByteTimeMap, resolveSeekFragment } from "./fmp4-seek";

const CHUNK_SIZE = 2 * 1024 * 1024;
const INIT_PROBE_SIZE = 512 * 1024;
const SEEK_PROBE_SIZE = 1024 * 1024;
const BUFFER_AHEAD_SECONDS = 30;
const BUFFER_BEHIND_SECONDS = 10;
const MAX_SEEK_PROBES = 6;
const SEEK_ACCEPT_UNDERSHOOT_SECONDS = 4;
const MAX_REALIGN_ATTEMPTS = 3;
const PROBE_STEP_OVERLAP_BYTES = 4096;

export interface MseVideoLoaderOptions {
  url: string;
  durationMs: number;
  video: HTMLVideoElement;
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
  private totalKnown = false;
  private eofReached = false;
  private initLength = 0;
  private nextOffset = 0;
  private initAppended = false;
  private pendingDurationSec: number | null = null;
  private tracks: Mp4Track[] = [];
  private anchors: ByteTimeMap | null = null;
  private pendingSeek: number | null = null;
  private seekGeneration = 0;
  private realignTarget: number | null = null;
  private realignAttempts = 0;
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

  setDuration(durationMs: number): void {
    if (this.destroyed) return;
    if (!Number.isFinite(durationMs) || durationMs <= 0) return;
    if (durationMs === this.opts.durationMs) return;
    this.opts.durationMs = durationMs;
    this.pendingDurationSec = durationMs / 1000;
    this.flushPendingDuration();
  }

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
    if (this.initAppended) {
      this.eofReached = false;
      this.schedulePump();
      return;
    }
    try {
      const durationSec = this.opts.durationMs / 1000;
      if (Number.isFinite(durationSec) && durationSec > 0) {
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
        throw new Error("fMP4 init segment declares no readable tracks");
      }

      const mime = `video/mp4; codecs="${parsed.codecs}"`;
      if (!window.MediaSource.isTypeSupported(mime)) {
        throw new Error(`Unsupported MSE type: ${mime}`);
      }

      const sb = this.mediaSource.addSourceBuffer(mime);
      sb.addEventListener("updateend", this.onSourceBufferIdle);
      sb.mode = "segments";
      this.sourceBuffer = sb;

      await this.appendBuffer(first.bytes.subarray(0, this.initLength));
      this.initAppended = true;

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
    this.schedulePump();
  };

  private onSeeking = (): void => {
    if (this.destroyed || !this.initAppended) return;
    const target = this.video.currentTime;
    this.seekGeneration++;
    if (this.isBuffered(target)) {
      this.pendingSeek = null;
      this.schedulePump();
      return;
    }

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

        if (this.downloadIsDisjoint()) {
          if (this.requestRealign(this.video.currentTime)) continue;
          break;
        }

        if (this.bufferedAhead() >= BUFFER_AHEAD_SECONDS) break;

        const chunkStart = this.nextOffset;
        const chunkEnd = this.totalKnown
          ? Math.min(chunkStart + CHUNK_SIZE, this.totalBytes) - 1
          : chunkStart + CHUNK_SIZE - 1;

        let res: { bytes: Uint8Array; eof: boolean };
        try {
          res = await this.fetchRange(chunkStart, chunkEnd);
        } catch (err) {
          if (isAbortError(err)) break;
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
      start += Math.max(1, res.bytes.byteLength - PROBE_STEP_OVERLAP_BYTES);
    }
    return null;
  }

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
      if (isAbortError(err)) return !this.destroyed;
      throw err;
    }
    if (this.destroyed) return false;
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
    this.abortParser();
    await this.appendWithQuota(chosen.bytes.subarray(chosen.moof));
    this.lastAppendSec = chosen.sec;
    this.nextOffset = chosen.fetchStart + chosen.bytes.byteLength;

    if (resolution.overshot) {
      this.nudgeCurrentTimeTo(chosen.sec);
      return true;
    }

    this.realignTarget = null;
    this.realignAttempts = 0;
    return true;
  }

  private downloadIsDisjoint(): boolean {
    if (this.lastAppendSec === null) return false;
    const t = this.video.currentTime;
    const end = this.bufferedEndAt(t);
    if (end === null) return true;
    return this.lastAppendSec > end + 1;
  }

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

  private nudgeCurrentTimeTo(sec: number): void {
    if (!Number.isFinite(sec) || sec < 0) {
      this.fail(new Error(`Cannot nudge the playhead to ${sec}`));
      return;
    }
    try {
      this.video.currentTime = sec + 0.05;
    } catch (err) {
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
      if (this.totalKnown && start < this.totalBytes) {
        throw new Error("Range 416 before known EOF: backing file replaced");
      }
      return { bytes: new Uint8Array(0), eof: true };
    }
    if (!res.ok) {
      throw new Error(`Range request failed: ${res.status}`);
    }
    if (rangeWasIgnored(res.status, start)) {
      throw new Error("Origin ignored the Range header; cannot stream windows");
    }
    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    const total = parseTotalFromContentRange(res.headers.get("content-range"));
    if (total != null && total > 0) {
      this.totalBytes = total;
      this.totalKnown = true;
    }

    const requested = end - start + 1;
    const eof =
      res.status === 200 ||
      bytes.byteLength < requested ||
      (this.totalKnown && start + bytes.byteLength >= this.totalBytes);

    return { bytes, eof };
  }
}
