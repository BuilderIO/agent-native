import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from "mediabunny";

export class NativeCameraClipError extends Error {
  constructor(
    readonly code:
      | "camera-clip-unreadable"
      | "camera-clip-short"
      | "camera-clip-decode"
      | "camera-clip-aborted"
      | "camera-clip-cleanup",
  ) {
    super(code);
    this.name = "NativeCameraClipError";
  }
}

const MAX_CLIP_BYTES = 96 * 1024 * 1024;
const DECODE_TIMEOUT_MS = 10_000;

export class NativeCameraClipCleanupError extends Error {
  constructor(readonly causes: readonly [unknown, unknown]) {
    super("Camera clip opening and cleanup both failed.");
    this.name = "NativeCameraClipCleanupError";
  }
}

async function bounded<T>(
  work: Promise<T>,
  signal: AbortSignal,
  discardLate?: (value: T) => void,
): Promise<T> {
  if (signal.aborted) throw new NativeCameraClipError("camera-clip-aborted");
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const timer = window.setTimeout(
      () => fail(new NativeCameraClipError("camera-clip-decode")),
      DECODE_TIMEOUT_MS,
    );
    const abort = () => fail(new NativeCameraClipError("camera-clip-aborted"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    work.then((value) => {
      if (settled) {
        discardLate?.(value);
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    }, fail);
  });
}

async function finishIterator<T>(
  iterator: AsyncIterator<T> | null,
): Promise<void> {
  if (!iterator?.return) return;
  try {
    await bounded(
      Promise.resolve(iterator.return()),
      new AbortController().signal,
    );
  } catch {
    throw new NativeCameraClipError("camera-clip-cleanup");
  }
}

export class NativeCameraClip {
  private readonly input: Input<BlobSource>;
  private frames: AsyncIterator<
    import("mediabunny").VideoSample | null
  > | null = null;
  private nextIndex = 0;
  private disposed = false;
  private disposal: Promise<void> | null = null;

  private constructor(input: Input<BlobSource>) {
    this.input = input;
  }

  static async open(
    blob: Blob,
    fps: number,
    frameCount: number,
    signal: AbortSignal,
  ): Promise<NativeCameraClip> {
    if (
      blob.size < 1 ||
      blob.size > MAX_CLIP_BYTES ||
      ![24, 30, 60].includes(fps) ||
      !Number.isInteger(frameCount) ||
      frameCount < 1 ||
      frameCount > 600
    )
      throw new NativeCameraClipError("camera-clip-unreadable");
    const input = new Input({
      source: new BlobSource(blob),
      formats: ALL_FORMATS,
    });
    const clip = new NativeCameraClip(input);
    try {
      const track = await bounded(input.getPrimaryVideoTrack(), signal);
      if (!track || !(await bounded(track.canDecode(), signal)))
        throw new NativeCameraClipError("camera-clip-unreadable");
      const sink = new VideoSampleSink(track);
      const firstFrames = sink.samples()[Symbol.asyncIterator]();
      let first: number;
      try {
        const firstFrame = await bounded(firstFrames.next(), signal, (late) => {
          if (!late.done) late.value.close();
        });
        if (firstFrame.done)
          throw new NativeCameraClipError("camera-clip-unreadable");
        first = firstFrame.value.timestamp;
        firstFrame.value.close();
      } finally {
        await finishIterator(firstFrames);
      }
      const end = await bounded(input.computeDuration([track]), signal);
      if (!Number.isFinite(first) || !Number.isFinite(end) || end <= first)
        throw new NativeCameraClipError("camera-clip-unreadable");
      if (end - first + 0.06 < (frameCount - 1) / fps)
        throw new NativeCameraClipError("camera-clip-short");
      const timestamps = Array.from(
        { length: frameCount },
        (_, index) => first + index / fps,
      );
      clip.frames = sink
        .samplesAtTimestamps(timestamps)
        [Symbol.asyncIterator]();
      return clip;
    } catch (error) {
      try {
        await clip.dispose();
      } catch (cleanupError) {
        throw new NativeCameraClipCleanupError([error, cleanupError]);
      }
      if (error instanceof NativeCameraClipError) throw error;
      throw new NativeCameraClipError("camera-clip-unreadable");
    }
  }

  async nextFrame(
    frameIndex: number,
    signal: AbortSignal,
  ): Promise<ImageBitmap> {
    if (this.disposed || !this.frames || frameIndex !== this.nextIndex)
      throw new NativeCameraClipError("camera-clip-decode");
    this.nextIndex++;
    let sample: import("mediabunny").VideoSample | null = null;
    try {
      const result = await bounded(this.frames.next(), signal, (late) => {
        if (!late.done) late.value?.close();
      });
      if (result.done || !result.value)
        throw new NativeCameraClipError("camera-clip-decode");
      sample = result.value;
      const frame = sample.toVideoFrame();
      try {
        const bitmap = await bounded(createImageBitmap(frame), signal, (late) =>
          late.close(),
        );
        if (
          !bitmap.width ||
          !bitmap.height ||
          bitmap.width > 1920 ||
          bitmap.height > 1080
        ) {
          bitmap.close();
          throw new NativeCameraClipError("camera-clip-decode");
        }
        return bitmap;
      } finally {
        frame.close();
      }
    } catch (error) {
      if (error instanceof NativeCameraClipError) throw error;
      throw new NativeCameraClipError("camera-clip-decode");
    } finally {
      sample?.close();
    }
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposed = true;
    const frames = this.frames;
    this.frames = null;
    this.disposal = (async () => {
      try {
        await finishIterator(frames);
      } finally {
        this.input.dispose();
      }
    })();
    // The runtime may call dispose without awaiting; export awaits this same promise.
    void this.disposal.catch(() => undefined);
    return this.disposal;
  }
}
