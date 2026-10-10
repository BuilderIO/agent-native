import {
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
  Quality,
  StreamTarget,
  VideoSample,
  VideoSampleSource,
  type StreamTargetChunk,
} from "mediabunny";

const MAX_SIDE = 4096;
const MAX_PIXELS = 8_388_608;
const MAX_FRAMES = 600;
const MAX_MP4_BYTES = 100_000_000;

class BoundedMp4Buffer {
  private bytes = new Uint8Array(0);
  private length = 0;

  write(chunk: StreamTargetChunk): void {
    const end = chunk.position + chunk.data.byteLength;
    if (
      chunk.type !== "write" ||
      !Number.isSafeInteger(chunk.position) ||
      chunk.position < 0 ||
      !Number.isSafeInteger(end) ||
      end > MAX_MP4_BYTES
    )
      throw new NativeSceneMp4Error(
        "output-unreadable",
        "Native MP4 output exceeds the local export limit.",
      );
    if (end > this.bytes.length) {
      const grown = new Uint8Array(
        Math.min(MAX_MP4_BYTES, Math.max(end, this.bytes.length * 2, 65_536)),
      );
      grown.set(this.bytes);
      this.bytes = grown;
    }
    this.bytes.set(chunk.data, chunk.position);
    this.length = Math.max(this.length, end);
  }

  finish(): ArrayBuffer {
    if (
      this.length < 16 ||
      String.fromCharCode(...this.bytes.subarray(4, 8)) !== "ftyp"
    )
      throw new NativeSceneMp4Error(
        "output-unreadable",
        "The encoded file does not contain an MP4 file header.",
      );
    return this.bytes.slice(0, this.length).buffer;
  }
}

export type NativeSceneMp4Frame = {
  frameIndex: number;
  width: number;
  height: number;
  colorSpace: "srgb";
  alpha: "straight";
  rgba: Uint8Array;
};

export type NativeSceneMp4Writer = {
  appendFrame(frame: NativeSceneMp4Frame): Promise<void>;
  finalize(): Promise<Blob>;
  cancel(): Promise<void>;
};

export class NativeSceneMp4Error extends Error {
  readonly cause: unknown;

  constructor(
    readonly code:
      | "invalid-options"
      | "codec-unavailable"
      | "frame-invalid"
      | "frame-order"
      | "encoder-failed"
      | "canceled"
      | "incomplete"
      | "output-unreadable",
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "NativeSceneMp4Error";
    this.cause = cause;
  }
}

export class NativeSceneMp4CleanupError extends Error {
  constructor(
    readonly errors: [unknown, unknown],
    message: string,
  ) {
    super(message);
    this.name = "NativeSceneMp4CleanupError";
  }
}

function aborted(signal: AbortSignal): void {
  if (signal.aborted)
    throw new NativeSceneMp4Error(
      "canceled",
      "Native video export was canceled.",
    );
}

function flattenStraightSrgb(
  rgba: Uint8Array,
  matte: { r: number; g: number; b: number },
): Uint8Array {
  const opaque = new Uint8Array(rgba.length);
  for (let index = 0; index < rgba.length; index += 4) {
    const alpha = rgba[index + 3] / 255;
    opaque[index] = Math.round(rgba[index] * alpha + matte.r * (1 - alpha));
    opaque[index + 1] = Math.round(
      rgba[index + 1] * alpha + matte.g * (1 - alpha),
    );
    opaque[index + 2] = Math.round(
      rgba[index + 2] * alpha + matte.b * (1 - alpha),
    );
    opaque[index + 3] = 255;
  }
  return opaque;
}

export async function createNativeSceneMp4Writer(args: {
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  signal: AbortSignal;
  quality?: "low" | "medium" | "high";
  matte?: { r: number; g: number; b: number };
  onProgress?: (completed: number, total: number) => void;
}): Promise<NativeSceneMp4Writer> {
  const { width, height, fps, frameCount, signal, onProgress } = args;
  const qualityName = args.quality ?? "high";
  const matte = args.matte ?? { r: 255, g: 255, b: 255 };
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 2 ||
    height < 2 ||
    width > MAX_SIDE ||
    height > MAX_SIDE ||
    width * height > MAX_PIXELS ||
    width % 2 !== 0 ||
    height % 2 !== 0 ||
    !Number.isInteger(fps) ||
    ![24, 30, 60].includes(fps) ||
    !Number.isInteger(frameCount) ||
    frameCount < 1 ||
    frameCount > MAX_FRAMES ||
    !["low", "medium", "high"].includes(qualityName) ||
    ![matte.r, matte.g, matte.b].every(
      (component) =>
        Number.isInteger(component) && component >= 0 && component <= 255,
    )
  )
    throw new NativeSceneMp4Error(
      "invalid-options",
      "Native MP4 dimensions, frame rate, or length are unsupported.",
    );
  aborted(signal);
  const format = new Mp4OutputFormat();
  const quality = new Quality(qualityName);
  const codec = await getFirstEncodableVideoCodec(["avc"], {
    width,
    height,
    frameRate: fps,
    quality,
  });
  aborted(signal);
  if (codec !== "avc" || !format.getSupportedVideoCodecs().includes(codec))
    throw new NativeSceneMp4Error(
      "codec-unavailable",
      "This browser cannot encode H.264 MP4 at the requested size and frame rate.",
    );

  const buffer = new BoundedMp4Buffer();
  const target = new StreamTarget(
    new WritableStream<StreamTargetChunk>({
      write(chunk) {
        buffer.write(chunk);
      },
    }),
  );
  const output = new Output({ format, target });
  const source = new VideoSampleSource({
    codec: "avc",
    quality,
    sizeChangeBehavior: "deny",
  });
  output.addVideoTrack(source);
  let accepted = 0;
  let finished = false;
  let canceledPromise: Promise<void> | undefined;
  let busy = false;
  const cancel = (): Promise<void> => {
    if (!canceledPromise) {
      signal.removeEventListener("abort", onAbort);
      canceledPromise = output.cancel();
    }
    return canceledPromise;
  };
  const onAbort = () => {
    void cancel().catch((error: unknown) => {
      console.error("Native MP4 encoder cancellation failed", error);
    });
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    aborted(signal);
    await output.start();
    aborted(signal);
  } catch (error) {
    try {
      await cancel();
    } catch (cleanupError) {
      throw new NativeSceneMp4CleanupError(
        [error, cleanupError],
        "Native MP4 setup and cleanup both failed.",
      );
    }
    throw error;
  }

  return {
    async appendFrame(frame) {
      aborted(signal);
      if (busy || finished || canceledPromise)
        throw new NativeSceneMp4Error(
          "frame-order",
          "Native MP4 frames must be appended serially before finalization.",
        );
      if (accepted >= frameCount || frame.frameIndex !== accepted)
        throw new NativeSceneMp4Error(
          "frame-order",
          `Expected native MP4 frame ${accepted}.`,
        );
      if (
        frame.width !== width ||
        frame.height !== height ||
        frame.colorSpace !== "srgb" ||
        frame.alpha !== "straight" ||
        !(frame.rgba instanceof Uint8Array) ||
        frame.rgba.byteLength !== width * height * 4
      )
        throw new NativeSceneMp4Error(
          "frame-invalid",
          "Native MP4 frame pixels do not match the selected scene.",
        );
      busy = true;
      let sample: VideoSample | undefined;
      let primaryFailure: unknown;
      let hasPrimaryFailure = false;
      try {
        const opaque = flattenStraightSrgb(frame.rgba, matte);
        sample = new VideoSample(opaque.buffer, {
          format: "RGBX",
          codedWidth: width,
          codedHeight: height,
          timestamp: accepted / fps,
          duration: 1 / fps,
          colorSpace: {
            primaries: "bt709",
            transfer: "iec61966-2-1",
            matrix: "rgb",
            fullRange: true,
          },
        });
        await source.add(sample);
        aborted(signal);
        accepted += 1;
        onProgress?.(accepted, frameCount);
      } catch (cause) {
        hasPrimaryFailure = true;
        primaryFailure = signal.aborted
          ? new NativeSceneMp4Error(
              "canceled",
              "Native video export was canceled.",
              cause,
            )
          : new NativeSceneMp4Error(
              "encoder-failed",
              "The browser could not encode a native MP4 frame.",
              cause,
            );
      }
      let closeFailure: unknown;
      let hasCloseFailure = false;
      try {
        sample?.close();
      } catch (error) {
        hasCloseFailure = true;
        closeFailure = error;
      } finally {
        busy = false;
      }
      if (hasPrimaryFailure && hasCloseFailure)
        throw new NativeSceneMp4CleanupError(
          [primaryFailure, closeFailure],
          "Native MP4 frame encoding and resource cleanup both failed.",
        );
      if (hasPrimaryFailure) throw primaryFailure;
      if (hasCloseFailure) throw closeFailure;
    },
    async finalize() {
      aborted(signal);
      if (busy || finished || canceledPromise)
        throw new NativeSceneMp4Error(
          "frame-order",
          "Native MP4 finalization cannot overlap a frame or canceled encoder.",
        );
      if (accepted !== frameCount)
        throw new NativeSceneMp4Error(
          "incomplete",
          `Native MP4 has ${accepted} of ${frameCount} frames.`,
        );
      finished = true;
      try {
        await output.finalize();
        aborted(signal);
        return new Blob([buffer.finish()], { type: "video/mp4" });
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    },
    cancel,
  };
}
