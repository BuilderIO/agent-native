import { describe, expect, it, vi } from "vitest";

import { EphemeralScreenObserver } from "./screen-observer";

function source(bytes = Buffer.from("png"), width = 800, height = 600) {
  return {
    id: "screen:1:0",
    name: "Confidential Customer Window",
    thumbnail: {
      isEmpty: () => false,
      getSize: () => ({ width, height }),
      toPNG: () => bytes,
    },
  };
}

describe("EphemeralScreenObserver", () => {
  it("fails closed with setup guidance without Screen Recording permission", async () => {
    const getSources = vi.fn();
    const observer = new EphemeralScreenObserver({
      desktopCapturer: { getSources },
      permissionStatus: () => ({
        screenRecording: "denied",
        accessibility: true,
      }),
    });

    await expect(observer.capture("task-1")).rejects.toThrow("System Settings");
    expect(getSources).not.toHaveBeenCalled();
  });

  it("returns redacted metadata and keeps bytes behind a task-scoped handle", async () => {
    const observer = new EphemeralScreenObserver({
      desktopCapturer: { getSources: vi.fn(async () => [source()]) },
      permissionStatus: () => ({
        screenRecording: "granted",
        accessibility: true,
      }),
      handle: () => "frame-handle",
      now: () => 100,
    });

    const frame = await observer.capture("task-1");
    expect(JSON.stringify(frame)).not.toContain("Confidential Customer Window");
    expect(observer.take(frame.handle, "other-task")).toBeUndefined();
    expect(observer.take(frame.handle, "task-1")?.toString()).toBe("png");
    expect(observer.take(frame.handle, "task-1")).toBeUndefined();
  });

  it("rejects oversized dimensions and PNG payloads", async () => {
    const oversizedDimensions = new EphemeralScreenObserver({
      desktopCapturer: {
        getSources: vi.fn(async () => [source(Buffer.from("png"), 2_000)]),
      },
      permissionStatus: () => ({
        screenRecording: "granted",
        accessibility: true,
      }),
      maxDimension: 1_920,
    });
    await expect(oversizedDimensions.capture("task-1")).rejects.toThrow(
      "dimensions",
    );

    const bytes = Buffer.alloc(10);
    const oversizedBytes = new EphemeralScreenObserver({
      desktopCapturer: { getSources: vi.fn(async () => [source(bytes)]) },
      permissionStatus: () => ({
        screenRecording: "granted",
        accessibility: true,
      }),
      maxBytes: 5,
    });
    await expect(oversizedBytes.capture("task-1")).rejects.toThrow("in-memory");
    expect(bytes.every((value) => value === 0)).toBe(true);
  });
});
