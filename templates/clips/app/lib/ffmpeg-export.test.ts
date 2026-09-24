import { afterEach, describe, expect, it, vi } from "vitest";

let lastExecArgs: string[] = [];
const originalDocument = (globalThis as { document?: unknown }).document;

class FakeFfmpeg {
  private handlers = new Map<string, (payload: unknown) => void>();

  on(event: string, handler: (payload: unknown) => void): void {
    this.handlers.set(event, handler);
  }

  off(event: string, handler: (payload: unknown) => void): void {
    if (this.handlers.get(event) === handler) this.handlers.delete(event);
  }

  async load(): Promise<void> {}

  async writeFile(): Promise<void> {}

  async exec(args: string[]): Promise<number> {
    lastExecArgs = args;
    this.handlers.get("log")?.({ message: "frame=12 fps=30" });
    this.handlers.get("progress")?.({ progress: 0.42 });
    return 0;
  }

  async readFile(): Promise<Uint8Array> {
    return new Uint8Array([1, 2, 3]);
  }

  async deleteFile(): Promise<void> {}
}

vi.mock("@ffmpeg/ffmpeg", () => ({ FFmpeg: FakeFfmpeg }));
vi.mock("@ffmpeg/util", () => ({
  fetchFile: vi.fn(async () => new Uint8Array([4, 5, 6])),
  toBlobURL: vi.fn(async (url: string) => url),
}));

import {
  exportConcat,
  exportMp4,
  resetFfmpegInstance,
  type ExportProgress,
} from "./ffmpeg-export";

const originalWindow = (globalThis as { window?: unknown }).window;

afterEach(() => {
  lastExecArgs = [];
  resetFfmpegInstance();
  if (originalDocument === undefined) {
    Reflect.deleteProperty(globalThis, "document");
  } else {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: originalDocument,
    });
  }
  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window");
  } else {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
});

describe("exportConcat", () => {
  it("normalizes differently sized recordings before concatenating", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {},
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        createElement: () => ({
          videoWidth: 1920,
          videoHeight: 1050,
          onloadedmetadata: null as (() => void) | null,
          onerror: null as (() => void) | null,
          load() {
            queueMicrotask(() => this.onloadedmetadata?.());
          },
          removeAttribute() {},
        }),
      },
    });

    const result = await exportConcat([
      { url: "/one.webm", width: 1920, height: 1080 },
      { url: "/two.webm", width: 0, height: 0 },
    ]);

    const filter = lastExecArgs[lastExecArgs.indexOf("-filter_complex") + 1];
    expect(filter).toContain(
      "[1:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2",
    );
    expect(result).toMatchObject({ width: 1920, height: 1080 });
  });

  it("uses supplied dimensions for fragmented MP4 sources", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {},
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        createElement: () => {
          throw new Error("fragmented MP4 metadata should not be probed");
        },
      },
    });

    await expect(
      exportConcat([
        {
          url: "/rewind.mp4",
          format: "mp4",
          width: 1920,
          height: 1080,
        },
        { url: "/clip.webm", width: 1280, height: 720 },
      ]),
    ).resolves.toMatchObject({ width: 1920, height: 1080 });
  });
});

describe("exportMp4 progress", () => {
  it("keeps ffmpeg log updates within the percentage range", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {},
    });

    const updates: ExportProgress[] = [];
    await exportMp4(
      {
        id: "rec-1",
        videoUrl: "/api/video/rec-1",
        durationMs: 1_000,
        videoFormat: "webm",
      },
      null,
      (progress) => updates.push(progress),
    );

    expect(updates.some((progress) => progress.message)).toBe(true);
    expect(updates.every((progress) => progress.progress >= 0)).toBe(true);
    expect(updates.every((progress) => progress.progress <= 1)).toBe(true);
    expect(updates.find((progress) => progress.message)?.progress).toBe(0);
  });
});
