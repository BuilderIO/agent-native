import { describe, expect, it, vi } from "vitest";

import { imageDataUrls } from "./content-media";

describe("a block's uploaded images", () => {
  it("stop where they are too large to show together", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const large: Promise<string | null> = Promise.resolve(
      "x".repeat(15_000_000),
    );
    const images = new Map(["a", "b", "c", "d"].map((id) => [id, large]));

    const urls = await imageDataUrls(images, [...images.keys()], () => false);

    expect([...urls.keys()]).toEqual(["a", "b"]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("stop loading when the block has changed", async () => {
    const images = new Map<string, Promise<string | null>>();

    expect((await imageDataUrls(images, ["a"], () => true)).size).toBe(0);
    expect(images.size).toBe(0);
  });
});
