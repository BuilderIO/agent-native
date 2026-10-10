import { beforeEach, describe, expect, it, vi } from "vitest";

const media = vi.hoisted(() => ({
  supportedCodec: "avc" as string | null,
  samples: [] as Array<{
    data: Uint8Array;
    init: Record<string, unknown>;
    closed: boolean;
  }>,
  accepted: [] as Array<{
    data: Uint8Array;
    init: Record<string, unknown>;
    closed: boolean;
  }>,
  addFailure: undefined as unknown,
  sampleFailure: undefined as unknown,
  closeFailure: undefined as unknown,
  finalizeChunkPosition: 0,
  cancelFailure: undefined as unknown,
  canceled: 0,
  finalized: 0,
  startFailure: undefined as unknown,
}));

vi.mock("mediabunny", () => ({
  getFirstEncodableVideoCodec: vi.fn(async () => media.supportedCodec),
  Mp4OutputFormat: class {
    getSupportedVideoCodecs() {
      return ["avc"];
    }
  },
  Output: class {
    private target: { writable: WritableStream<unknown> };
    constructor(options: { target: { writable: WritableStream<unknown> } }) {
      this.target = options.target;
    }
    addVideoTrack() {}
    async start() {
      if (media.startFailure !== undefined) throw media.startFailure;
    }
    async finalize() {
      media.finalized += 1;
      const data = new Uint8Array([
        0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0,
      ]);
      const writer = this.target.writable.getWriter();
      await writer.write({
        type: "write",
        position: media.finalizeChunkPosition,
        data,
      });
      await writer.close();
    }
    async cancel() {
      media.canceled += 1;
      if (media.cancelFailure !== undefined) throw media.cancelFailure;
    }
  },
  Quality: class {
    constructor(_value: string) {}
  },
  StreamTarget: class {
    constructor(readonly writable: WritableStream<unknown>) {}
  },
  VideoSample: class {
    data: Uint8Array;
    init: Record<string, unknown>;
    closed = false;
    constructor(buffer: ArrayBuffer, init: Record<string, unknown>) {
      if (media.sampleFailure !== undefined) throw media.sampleFailure;
      this.data = new Uint8Array(buffer);
      this.init = init;
      media.samples.push(this);
    }
    close() {
      this.closed = true;
      if (media.closeFailure !== undefined) throw media.closeFailure;
    }
  },
  VideoSampleSource: class {
    async add(sample: (typeof media.samples)[number]) {
      if (media.addFailure !== undefined) throw media.addFailure;
      media.accepted.push(sample);
    }
  },
}));

import {
  createNativeSceneMp4Writer,
  NativeSceneMp4CleanupError,
  NativeSceneMp4Error,
} from "./native-scene-mp4-writer";

const pixelFrame = (frameIndex: number) => ({
  frameIndex,
  width: 2,
  height: 2,
  colorSpace: "srgb" as const,
  alpha: "straight" as const,
  rgba: new Uint8Array([
    20, 40, 60, 255, 10, 20, 30, 0, 0, 100, 200, 128, 50, 60, 70, 255,
  ]),
});

beforeEach(() => {
  media.supportedCodec = "avc";
  media.samples = [];
  media.accepted = [];
  media.addFailure = undefined;
  media.sampleFailure = undefined;
  media.closeFailure = undefined;
  media.finalizeChunkPosition = 0;
  media.cancelFailure = undefined;
  media.startFailure = undefined;
  media.canceled = 0;
  media.finalized = 0;
});

describe("native scene MP4 writer", () => {
  it("accepts exact ordered samples with rational timestamps, flattens alpha on white, and finalizes MP4", async () => {
    const onProgress = vi.fn();
    const writer = await createNativeSceneMp4Writer({
      width: 2,
      height: 2,
      fps: 60,
      frameCount: 2,
      signal: new AbortController().signal,
      onProgress,
    });
    await writer.appendFrame(pixelFrame(0));
    await writer.appendFrame(pixelFrame(1));
    await expect(writer.appendFrame(pixelFrame(2))).rejects.toMatchObject({
      code: "frame-order",
    });
    const blob = await writer.finalize();

    expect(blob.type).toBe("video/mp4");
    expect(blob.size).toBe(16);
    expect(media.accepted).toHaveLength(2);
    expect(media.accepted.map((sample) => sample.init.timestamp)).toEqual([
      0,
      1 / 60,
    ]);
    expect(media.accepted.map((sample) => sample.init.duration)).toEqual([
      1 / 60,
      1 / 60,
    ]);
    expect([...media.accepted[0].data.slice(0, 8)]).toEqual([
      20, 40, 60, 255, 255, 255, 255, 255,
    ]);
    expect(media.samples.every((sample) => sample.closed)).toBe(true);
    expect(onProgress.mock.calls).toEqual([
      [1, 2],
      [2, 2],
    ]);
    expect(media.finalized).toBe(1);
  });

  it("rejects unsupported H.264 rather than writing a misleading file", async () => {
    media.supportedCodec = null;
    await expect(
      createNativeSceneMp4Writer({
        width: 2,
        height: 2,
        fps: 60,
        frameCount: 2,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "codec-unavailable" });
  });

  it("rejects skipped, malformed, and incomplete frames", async () => {
    const writer = await createNativeSceneMp4Writer({
      width: 2,
      height: 2,
      fps: 60,
      frameCount: 2,
      signal: new AbortController().signal,
    });
    await expect(writer.appendFrame(pixelFrame(1))).rejects.toMatchObject({
      code: "frame-order",
    });
    await expect(
      writer.appendFrame({ ...pixelFrame(0), rgba: new Uint8Array(2) }),
    ).rejects.toMatchObject({ code: "frame-invalid" });
    await writer.appendFrame(pixelFrame(0));
    await expect(writer.finalize()).rejects.toMatchObject({
      code: "incomplete",
    });
    await writer.cancel();
    expect(media.canceled).toBe(1);
  });

  it("closes a rejected sample and permits idempotent cancellation", async () => {
    const controller = new AbortController();
    const writer = await createNativeSceneMp4Writer({
      width: 2,
      height: 2,
      fps: 60,
      frameCount: 1,
      signal: controller.signal,
    });
    media.addFailure = new Error("encoder failed");
    await expect(writer.appendFrame(pixelFrame(0))).rejects.toMatchObject({
      code: "encoder-failed",
    });
    expect(media.samples[0].closed).toBe(true);
    await writer.cancel();
    await writer.cancel();
    expect(media.canceled).toBe(1);
    controller.abort();
    await expect(writer.appendFrame(pixelFrame(0))).rejects.toMatchObject({
      code: "canceled",
    });
  });

  it("recovers its serial lock when sample construction fails", async () => {
    const writer = await createNativeSceneMp4Writer({
      width: 2,
      height: 2,
      fps: 60,
      frameCount: 1,
      signal: new AbortController().signal,
    });
    media.sampleFailure = new Error("VideoFrame unavailable");
    await expect(writer.appendFrame(pixelFrame(0))).rejects.toMatchObject({
      code: "encoder-failed",
    });
    media.sampleFailure = undefined;
    await writer.appendFrame(pixelFrame(0));
    await expect(writer.finalize()).resolves.toBeInstanceOf(Blob);
  });

  it("uses an explicit matte and retains both encode and cleanup errors", async () => {
    const writer = await createNativeSceneMp4Writer({
      width: 2,
      height: 2,
      fps: 30,
      frameCount: 1,
      signal: new AbortController().signal,
      matte: { r: 0, g: 80, b: 160 },
      quality: "medium",
    });
    media.addFailure = new Error("encode failed");
    media.closeFailure = new Error("close failed");
    const failure = await writer
      .appendFrame(pixelFrame(0))
      .catch((error) => error);
    expect(failure).toBeInstanceOf(NativeSceneMp4CleanupError);
    expect(failure.errors).toHaveLength(2);
    expect(failure.errors[0]).toMatchObject({ code: "encoder-failed" });
    expect(failure.errors[1]).toBe(media.closeFailure);
    expect([...media.samples[0].data.slice(4, 8)]).toEqual([0, 80, 160, 255]);
    media.addFailure = undefined;
    media.closeFailure = undefined;
    await writer.appendFrame(pixelFrame(0));
    await writer.finalize();
  });

  it("rejects a stream write beyond the byte cap before allocating", async () => {
    const writer = await createNativeSceneMp4Writer({
      width: 2,
      height: 2,
      fps: 60,
      frameCount: 1,
      signal: new AbortController().signal,
    });
    await writer.appendFrame(pixelFrame(0));
    media.finalizeChunkPosition = 100_000_000;
    await expect(writer.finalize()).rejects.toMatchObject({
      code: "output-unreadable",
    });
    await writer.cancel();
  });

  it("rejects odd H.264 dimensions and unsupported frame rates before allocating", async () => {
    await expect(
      createNativeSceneMp4Writer({
        width: 3,
        height: 2,
        fps: 60,
        frameCount: 180,
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(NativeSceneMp4Error);
    await expect(
      createNativeSceneMp4Writer({
        width: 2,
        height: 2,
        fps: 120,
        frameCount: 180,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "invalid-options" });
    await expect(
      createNativeSceneMp4Writer({
        width: 2,
        height: 2,
        fps: 60,
        frameCount: 1,
        matte: { r: 256, g: 0, b: 0 },
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "invalid-options" });
    expect(media.samples).toHaveLength(0);
  });
});
