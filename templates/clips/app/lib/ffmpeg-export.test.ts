import { afterEach, describe, expect, it, vi } from "vitest";

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

  async exec(): Promise<void> {
    this.handlers.get("log")?.({ message: "frame=12 fps=30" });
    this.handlers.get("progress")?.({ progress: 0.42 });
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
  exportMp4,
  resetFfmpegInstance,
  type ExportProgress,
} from "./ffmpeg-export";

const originalWindow = (globalThis as { window?: unknown }).window;

afterEach(() => {
  resetFfmpegInstance();
  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window");
  } else {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
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
