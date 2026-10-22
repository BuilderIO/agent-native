import { afterEach, describe, expect, it, vi } from "vitest";

const opaque = vi.hoisted(() => ({
  active: false,
  resolve: vi.fn(),
}));

vi.mock("./native-opaque-public-asset", () => ({
  isOpaquePublicAssetPreview: () => opaque.active,
  resolveOpaquePublicAssetBlob: opaque.resolve,
}));

import { NativeWorkerInputAssets } from "./native-worker-input-assets";

describe("native worker input assets", () => {
  afterEach(() => {
    opaque.active = false;
    opaque.resolve.mockReset();
    vi.unstubAllGlobals();
  });

  it("decodes linear data without color conversion and fetches a bounded asset once", async () => {
    vi.stubGlobal("location", {
      href: "about:srcdoc",
      origin: "https://example.test",
    });
    const fetch = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3, 4]), {
          headers: { "content-type": "image/png" },
        }),
    );
    const decode = vi.fn(async () => ({
      width: 2,
      height: 2,
      close: vi.fn(),
    }));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("createImageBitmap", decode);
    const assets = new NativeWorkerInputAssets();

    await assets.bitmap("/shaders/noise.png", "linear-data");
    await assets.bitmap("/shaders/noise.png", "linear-data");

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "https://example.test/shaders/noise.png",
      expect.objectContaining({
        credentials: "same-origin",
        mode: "same-origin",
        redirect: "error",
      }),
    );
    expect(decode).toHaveBeenCalledTimes(2);
    expect(decode).toHaveBeenCalledWith(expect.any(Blob), {
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    });
    assets.dispose();
  });

  it("decodes a bridged opaque asset directly without a CSP-blocked fetch", async () => {
    opaque.active = true;
    opaque.resolve.mockResolvedValue(
      new Blob([new Uint8Array([1, 2])], { type: "image/png" }),
    );
    const fetch = vi.fn();
    const decode = vi.fn(async () => ({ width: 2, height: 2, close: vi.fn() }));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("createImageBitmap", decode);
    const assets = new NativeWorkerInputAssets();

    await assets.bitmap("/shaders/noise.png", "linear-data");

    expect(opaque.resolve).toHaveBeenCalledWith("/shaders/noise.png");
    expect(fetch).not.toHaveBeenCalled();
    expect(decode).toHaveBeenCalledWith(expect.any(Blob), {
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    });
    assets.dispose();
  });
});
