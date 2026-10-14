// @vitest-environment happy-dom

import React, { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loaders: [] as unknown[],
  sniffFragmentedMp4: vi.fn(),
}));

vi.mock("@/lib/fmp4", () => ({
  sniffFragmentedMp4: mocks.sniffFragmentedMp4,
}));

vi.mock("@/lib/mse-video-loader", () => ({
  isMediaSourceSupported: () => true,
  MseVideoLoader: class {
    objectUrl = "blob:test";
    destroy = vi.fn();
    updateUrl = vi.fn();
    url: string;

    constructor({ url }: { url: string }) {
      this.url = url;
      mocks.loaders.push(this);
    }
  },
}));

import { useMseVideoSource } from "./use-mse-video-source";

function Harness({ sourceUrl }: { sourceUrl: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useMseVideoSource({
    videoRef,
    sourceUrl,
    durationMs: 10_000,
    videoFormat: "mp4",
  });
  return <video ref={videoRef} />;
}

describe("useMseVideoSource", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.loaders.length = 0;
    mocks.sniffFragmentedMp4.mockReset().mockResolvedValue(true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps playback loaded as access passes rotate and reloads on media changes", async () => {
    const oldPass = "/api/video/rec_1?t=old&media=7";
    const renewedPass = "/api/video/rec_1?t=new&media=7";
    const updatedMedia = "/api/video/rec_1?t=new&media=8";

    await act(async () => {
      root.render(<Harness sourceUrl={oldPass} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mocks.loaders).toHaveLength(1);
    const firstLoader = mocks.loaders[0] as {
      destroy: ReturnType<typeof vi.fn>;
      updateUrl: ReturnType<typeof vi.fn>;
    };

    await act(async () => {
      root.render(<Harness sourceUrl={renewedPass} />);
    });
    expect(mocks.loaders).toHaveLength(1);
    expect(firstLoader.destroy).not.toHaveBeenCalled();
    expect(firstLoader.updateUrl).toHaveBeenCalledWith(renewedPass);

    await act(async () => {
      root.render(<Harness sourceUrl={updatedMedia} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(firstLoader.destroy).toHaveBeenCalledOnce();
    expect(mocks.loaders).toHaveLength(2);
  });

  it("constructs the loader with a renewed URL when it rotates during sniffing", async () => {
    const oldPass = "/api/video/rec_1?t=old&media=7";
    const renewedPass = "/api/video/rec_1?t=new&media=7";
    let resolveSniff!: (isFragmented: boolean) => void;
    const sniffPromise = new Promise<boolean>((resolve) => {
      resolveSniff = resolve;
    });
    mocks.sniffFragmentedMp4.mockReturnValue(sniffPromise);

    await act(async () => {
      root.render(<Harness sourceUrl={oldPass} />);
    });
    expect(mocks.sniffFragmentedMp4).toHaveBeenCalledWith(oldPass);

    await act(async () => {
      root.render(<Harness sourceUrl={renewedPass} />);
    });
    resolveSniff(true);
    await act(async () => {
      await sniffPromise;
    });

    expect(mocks.loaders).toHaveLength(1);
    expect(mocks.loaders[0]).toMatchObject({ url: renewedPass });
  });
});
