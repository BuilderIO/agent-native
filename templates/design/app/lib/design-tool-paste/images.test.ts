import { describe, expect, it, vi } from "vitest";

import { emitFrames } from "./emit";
import { hostRemoteImages } from "./images";
import { PASTE_LIMITS, type PasteFrame } from "./ir";

const frame = (...urls: string[]): PasteFrame => ({
  title: "Frame",
  width: 100,
  height: 100,
  origin: null,
  root: {
    kind: "box",
    label: "Root",
    style: {},
    children: urls.map((url) => ({
      kind: "box" as const,
      label: "Image",
      style: {},
      images: [{ url, size: "cover" }],
      children: [],
    })),
  },
});

const A = "https://cdn.example.test/a.png?x=1&y=2";
const B = "https://cdn.example.test/b.png";

describe("hostRemoteImages", () => {
  it("rewrites every link to its hosted copy, including & in a URL", async () => {
    const { layers, imageUrls } = emitFrames([frame(A, B)], []);
    const mirror = vi.fn(
      async (url: string) => `https://files.test/${url.length}`,
    );
    const result = await hostRemoteImages(
      layers,
      imageUrls,
      mirror,
      "p:image:",
    );
    expect(mirror).toHaveBeenCalledTimes(2);
    expect(result.kept).toBe(0);
    expect(result.layers[0]?.content).not.toContain("cdn.example.test");
    expect(result.layers[0]?.content).toContain("https://files.test/");
  });

  it("hosts what it can and counts the rest as kept", async () => {
    const { layers, imageUrls } = emitFrames([frame(A, B)], []);
    const result = await hostRemoteImages(
      layers,
      imageUrls,
      async (url) => {
        if (url === A) return "https://files.test/a";
        throw new Error("storage rejected it");
      },
      "p:image:",
    );
    expect(result.kept).toBe(1);
    expect(result.reason).toBe("storage rejected it");
    expect(result.keys).toEqual(["p:image:0"]);
    // The failed upload's key is reported too, so its receipt can be cleared.
    expect(result.attemptedKeys.sort()).toEqual(["p:image:0", "p:image:1"]);
    expect(result.layers[0]?.content).toContain("https://files.test/a");
    expect(result.layers[0]?.content).toContain(B);
  });

  it("keeps the layers untouched when nothing can be hosted", async () => {
    const { layers, imageUrls } = emitFrames([frame(A)], []);
    const result = await hostRemoteImages(
      layers,
      imageUrls,
      async () => {
        throw new Error("file storage is not set up");
      },
      "p:image:",
    );
    expect(result).toEqual({
      layers,
      kept: 1,
      reason: "file storage is not set up",
      keys: [],
      attemptedKeys: ["p:image:0"],
    });
  });

  it("gives each upload a receipt key so it can be released or deleted", async () => {
    const { layers, imageUrls } = emitFrames([frame(A, B)], []);
    const mirror = vi.fn(async (url: string, key: string) => `${url}#${key}`);
    const result = await hostRemoteImages(
      layers,
      imageUrls,
      mirror,
      "run:image:",
    );
    expect(mirror.mock.calls.map(([, key]) => key).sort()).toEqual([
      "run:image:0",
      "run:image:1",
    ]);
    expect(result.keys.sort()).toEqual(["run:image:0", "run:image:1"]);
  });

  it("hosts each distinct image once and never exceeds six at a time", async () => {
    const urls = Array.from(
      { length: 9 },
      (_, i) => `https://cdn.example.test/${i}.png`,
    );
    const { layers, imageUrls } = emitFrames(
      [frame(...urls, urls[0] ?? "")],
      [],
    );
    let active = 0;
    let peak = 0;
    const mirror = vi.fn(async (url: string) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return `${url}.hosted`;
    });
    await hostRemoteImages(layers, imageUrls, mirror, "p:image:");
    expect(mirror).toHaveBeenCalledTimes(9);
    expect(peak).toBeLessThanOrEqual(6);
  });

  it("hosts only the first batch of images and reports the rest as kept", async () => {
    const limit = PASTE_LIMITS.hostedImages;
    const urls = Array.from(
      { length: limit + 1 },
      (_, i) => `https://cdn.example.test/${i}.png`,
    );
    const { layers } = emitFrames([frame(...urls)], []);
    const mirror = vi.fn(async (url: string, _key: string) => `${url}.hosted`);
    const result = await hostRemoteImages(layers, urls, mirror, "p:image:");
    expect(mirror).toHaveBeenCalledTimes(limit);
    expect(mirror.mock.calls.some(([url]) => url === urls[limit])).toBe(false);
    expect(result.kept).toBe(1);
    expect(result.reason).toBe(`only the first ${limit} images are copied`);
  });

  it("gives up on an upload that never answers and keeps its link", async () => {
    vi.useFakeTimers();
    try {
      const { layers, imageUrls } = emitFrames([frame(A)], []);
      const pending = hostRemoteImages(
        layers,
        imageUrls,
        () => new Promise<string>(() => {}),
        "p:image:",
      );
      await vi.advanceTimersByTimeAsync(PASTE_LIMITS.imageTimeoutMs + 1);
      const result = await pending;
      expect(result.kept).toBe(1);
      expect(result.reason).toBe("the upload timed out");
      // Its key is reported, so the caller can clear a receipt it left behind.
      expect(result.attemptedKeys).toEqual(["p:image:0"]);
      expect(result.keys).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops starting uploads once the paste's time budget is spent", async () => {
    vi.useFakeTimers();
    try {
      const urls = Array.from(
        { length: PASTE_LIMITS.hostedImages },
        (_, i) => `https://cdn.example.test/${i}.png`,
      );
      const { layers } = emitFrames([frame(...urls)], []);
      // Each upload takes just under the per-image limit, so the shared
      // budget runs out before every image has started.
      const mirror = vi.fn(
        (url: string, _key: string) =>
          new Promise<string>((resolve) =>
            setTimeout(() => resolve(`${url}.hosted`), 15_000),
          ),
      );
      const pending = hostRemoteImages(layers, urls, mirror, "p:image:");
      await vi.advanceTimersByTimeAsync(PASTE_LIMITS.imageBudgetMs * 3);
      const result = await pending;
      expect(mirror.mock.calls.length).toBeLessThan(urls.length);
      expect(result.kept).toBe(urls.length - mirror.mock.calls.length);
      expect(result.reason).toBe("copying the images took too long");
    } finally {
      vi.useRealTimers();
    }
  });
});
