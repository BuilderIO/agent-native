// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertReplayFontsReady,
  assertRemoteImagesCapturable,
  crossOriginImageUrls,
  ReplayScreenshotAssetError,
} from "./session-replay-screenshot";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("session replay screenshot asset checks", () => {
  it("finds remote images in pseudo-element content, backgrounds, and masks", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (_element, pseudo) =>
        ({
          backgroundImage:
            pseudo === "::before"
              ? 'url("https://assets.example.test/before.png")'
              : "none",
          maskImage:
            pseudo === "::after"
              ? 'url("https://assets.example.test/after-mask.png")'
              : "none",
          listStyleImage:
            pseudo == null
              ? 'url("https://assets.example.test/list-style.png")'
              : "none",
          content:
            pseudo === "::after"
              ? 'url("https://assets.example.test/after-content.png")'
              : "none",
        }) as CSSStyleDeclaration,
    );

    expect(crossOriginImageUrls(document)).toEqual(
      expect.arrayContaining([
        "https://assets.example.test/before.png",
        "https://assets.example.test/after-mask.png",
        "https://assets.example.test/after-content.png",
        "https://assets.example.test/list-style.png",
      ]),
    );

    element.remove();
  });

  it("scans image styles attached to the document root", () => {
    const root = document.documentElement;
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element, pseudo) =>
        ({
          backgroundImage:
            element === root && pseudo == null
              ? 'url("https://assets.example.test/root-background.png")'
              : "none",
          maskImage: "none",
          listStyleImage: "none",
          content:
            element === root && pseudo === "::before"
              ? 'url("https://assets.example.test/root-content.png")'
              : "none",
        }) as CSSStyleDeclaration,
    );

    expect(crossOriginImageUrls(document)).toEqual(
      expect.arrayContaining([
        "https://assets.example.test/root-background.png",
        "https://assets.example.test/root-content.png",
      ]),
    );
  });

  it("finds quoted image-set candidates and image-submit sources", () => {
    const input = document.createElement("input");
    input.type = "image";
    input.src = "https://assets.example.test/submit.png";
    document.body.appendChild(input);
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (_element, pseudo) =>
        ({
          backgroundImage:
            pseudo == null
              ? 'image-set("https://assets.example.test/one.png" 1x, "https://assets.example.test/two.png" 2x)'
              : "none",
          maskImage: "none",
          listStyleImage: "none",
          content: "none",
        }) as CSSStyleDeclaration,
    );

    expect(crossOriginImageUrls(document)).toEqual(
      expect.arrayContaining([
        "https://assets.example.test/one.png",
        "https://assets.example.test/two.png",
        "https://assets.example.test/submit.png",
      ]),
    );

    input.remove();
  });

  it("finds remote SVG images and images in accessible child frames", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const svgImage = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "image",
    );
    svgImage.setAttribute("href", "https://assets.example.test/inline.svg");
    svg.appendChild(svgImage);
    const svgUse = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "use",
    );
    svgUse.setAttribute("href", "https://assets.example.test/symbol.svg#icon");
    svg.appendChild(svgUse);
    const filterImage = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "feImage",
    );
    filterImage.setAttributeNS(
      "http://www.w3.org/1999/xlink",
      "xlink:href",
      "https://assets.example.test/filter.png",
    );
    svg.appendChild(filterImage);

    const childDocument = document.implementation.createHTMLDocument();
    const nestedAsset = childDocument.createElement("div");
    nestedAsset.style.backgroundImage =
      "url(https://assets.example.test/nested.png)";
    childDocument.body.appendChild(nestedAsset);
    const frame = {
      contentDocument: childDocument,
      getAttribute: () => null,
    } as unknown as HTMLIFrameElement;
    const querySelectorAll = document.querySelectorAll.bind(document);
    vi.spyOn(document, "querySelectorAll").mockImplementation(((
      selector: string,
    ) =>
      selector === "iframe"
        ? ([frame] as unknown as NodeListOf<Element>)
        : querySelectorAll(selector)) as typeof document.querySelectorAll);
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element) =>
        ({
          backgroundImage:
            element === nestedAsset
              ? nestedAsset.style.backgroundImage
              : "none",
          maskImage: "none",
          content: "none",
        }) as CSSStyleDeclaration,
    );
    document.body.appendChild(svg);

    expect(crossOriginImageUrls(document)).toEqual(
      expect.arrayContaining([
        "https://assets.example.test/inline.svg",
        "https://assets.example.test/symbol.svg#icon",
        "https://assets.example.test/filter.png",
        "https://assets.example.test/nested.png",
      ]),
    );

    svg.remove();
  });

  it("rejects nested frames whose assets cannot be inspected", () => {
    let frame = {
      contentDocument: null,
      getAttribute: () => "https://frame.example.test/",
    } as unknown as HTMLIFrameElement;
    vi.spyOn(document, "querySelectorAll").mockImplementation(((
      selector: string,
    ) =>
      selector === "iframe"
        ? ([frame] as unknown as NodeListOf<Element>)
        : document
            .createElement("div")
            .querySelectorAll(selector)) as typeof document.querySelectorAll);

    expect(() => crossOriginImageUrls(document)).toThrow(
      ReplayScreenshotAssetError,
    );

    frame = {
      contentDocument: null,
      getAttribute: () => null,
    } as unknown as HTMLIFrameElement;
    expect(() => crossOriginImageUrls(document)).toThrow(
      ReplayScreenshotAssetError,
    );

    frame = {
      contentDocument: null,
      getAttribute: (name: string) =>
        name === "srcdoc" ? "<p>embedded document</p>" : null,
    } as unknown as HTMLIFrameElement;
    expect(() => crossOriginImageUrls(document)).toThrow(
      ReplayScreenshotAssetError,
    );
  });

  it("rejects video sources rather than saving a blank media frame", async () => {
    const video = document.createElement("video");
    Object.defineProperty(video, "currentSrc", {
      configurable: true,
      value: "https://assets.example.test/recording.mp4",
    });
    document.body.appendChild(video);

    await expect(assertRemoteImagesCapturable(document)).rejects.toBeInstanceOf(
      ReplayScreenshotAssetError,
    );

    video.remove();
  });

  it("rejects poster-only videos and border-image visuals", () => {
    const video = document.createElement("video");
    video.poster = "https://assets.example.test/poster.png";
    document.body.appendChild(video);
    expect(() => crossOriginImageUrls(document)).toThrow(
      ReplayScreenshotAssetError,
    );
    video.remove();

    const element = document.createElement("div");
    document.body.appendChild(element);
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      backgroundImage: "none",
      listStyleImage: "none",
      maskImage: "none",
      borderImageSource: 'url("https://assets.example.test/frame.png")',
    } as CSSStyleDeclaration);
    expect(() => crossOriginImageUrls(document)).toThrow(
      ReplayScreenshotAssetError,
    );
    element.remove();
  });

  it("rejects embedded object and embed content", async () => {
    const object = document.createElement("object");
    object.data = "https://assets.example.test/document.svg";
    document.body.appendChild(object);
    await expect(assertRemoteImagesCapturable(document)).rejects.toBeInstanceOf(
      ReplayScreenshotAssetError,
    );
    object.remove();

    const embed = document.createElement("embed");
    embed.src = "https://assets.example.test/image.svg";
    document.body.appendChild(embed);
    await expect(assertRemoteImagesCapturable(document)).rejects.toBeInstanceOf(
      ReplayScreenshotAssetError,
    );
    embed.remove();
  });

  it("bounds replay font readiness", async () => {
    vi.useFakeTimers();
    const fontsDescriptor = Object.getOwnPropertyDescriptor(document, "fonts");
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: new Promise<void>(() => {}) },
    });

    try {
      const pending = assertReplayFontsReady(document);
      const rejection = expect(pending).rejects.toBeInstanceOf(
        ReplayScreenshotAssetError,
      );
      await vi.advanceTimersByTimeAsync(8_000);
      await rejection;
    } finally {
      if (fontsDescriptor) {
        Object.defineProperty(document, "fonts", fontsDescriptor);
      } else {
        Reflect.deleteProperty(document, "fonts");
      }
    }
  });

  it("waits for fonts in accessible child frames", async () => {
    const childDocument = document.implementation.createHTMLDocument();
    let resolveChildFonts: () => void = () => {};
    const childFontsReady = new Promise<void>((resolve) => {
      resolveChildFonts = resolve;
    });
    Object.defineProperty(childDocument, "fonts", {
      configurable: true,
      value: { ready: childFontsReady },
    });
    const frame = {
      contentDocument: childDocument,
      getAttribute: () => null,
    } as unknown as HTMLIFrameElement;
    const querySelectorAll = document.querySelectorAll.bind(document);
    vi.spyOn(document, "querySelectorAll").mockImplementation(((
      selector: string,
    ) =>
      selector === "iframe"
        ? ([frame] as unknown as NodeListOf<Element>)
        : querySelectorAll(selector)) as typeof document.querySelectorAll);

    let finished = false;
    const pending = assertReplayFontsReady(document).then(() => {
      finished = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(finished).toBe(false);

    resolveChildFonts();
    await pending;
    expect(finished).toBe(true);
  });

  it("times out remote asset checks instead of waiting indefinitely", async () => {
    vi.useFakeTimers();
    const image = document.createElement("img");
    image.src = "https://assets.example.test/slow.png";
    document.body.appendChild(image);
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );

    const pending = assertRemoteImagesCapturable(document);
    const rejection = expect(pending).rejects.toBeInstanceOf(
      ReplayScreenshotAssetError,
    );
    await vi.advanceTimersByTimeAsync(8_000);
    await rejection;

    image.remove();
  });

  it("rejects same-origin image URLs that redirect off-origin", async () => {
    const image = document.createElement("img");
    image.src = "/redirected-image.png";
    document.body.appendChild(image);
    const cancelBody = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      body: { cancel: cancelBody },
      headers: { get: () => "image/png" },
      ok: true,
      url: "https://cdn.example.test/redirected-image.png",
    } as unknown as Response);

    await expect(assertRemoteImagesCapturable(document)).rejects.toBeInstanceOf(
      ReplayScreenshotAssetError,
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      `${window.location.origin}/redirected-image.png`,
      expect.objectContaining({
        credentials: "same-origin",
        mode: "cors",
      }),
    );
    expect(cancelBody).toHaveBeenCalledOnce();

    image.remove();
  });

  it("limits parallel checks and releases response bodies after reading headers", async () => {
    const images = Array.from({ length: 9 }, (_, index) => {
      const image = document.createElement("img");
      image.src = `https://assets.example.test/${index}.png`;
      document.body.appendChild(image);
      return image;
    });
    let active = 0;
    let maximumActive = 0;
    const cancelBodies = vi.fn();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return {
          body: { cancel: cancelBodies },
          headers: { get: () => "image/png" },
          ok: true,
        } as unknown as Response;
      });

    await expect(
      assertRemoteImagesCapturable(document),
    ).resolves.toBeUndefined();

    expect(fetchSpy).toHaveBeenCalledTimes(9);
    expect(maximumActive).toBeLessThanOrEqual(4);
    expect(cancelBodies).toHaveBeenCalledTimes(9);
    images.forEach((image) => image.remove());
  });

  it("aborts in-flight asset checks after the first failed response", async () => {
    const failed = document.createElement("img");
    failed.src = "https://assets.example.test/fail.png";
    const pending = document.createElement("img");
    pending.src = "https://assets.example.test/pending.png";
    document.body.append(failed, pending);
    let pendingRequestAborted = false;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      if (String(input).includes("fail.png")) {
        return Promise.resolve({
          body: { cancel: vi.fn() },
          headers: { get: () => "text/plain" },
          ok: false,
        } as unknown as Response);
      }
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          pendingRequestAborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });

    await expect(assertRemoteImagesCapturable(document)).rejects.toBeInstanceOf(
      ReplayScreenshotAssetError,
    );
    expect(pendingRequestAborted).toBe(true);

    failed.remove();
    pending.remove();
  });

  it("rejects when it cannot release a preflight response body", async () => {
    const image = document.createElement("img");
    image.src = "https://assets.example.test/cancel-fails.png";
    document.body.appendChild(image);
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      body: {
        cancel: () => Promise.reject(new Error("body cancellation failed")),
      },
      headers: { get: () => "image/png" },
      ok: true,
    } as unknown as Response);

    await expect(assertRemoteImagesCapturable(document)).rejects.toBeInstanceOf(
      ReplayScreenshotAssetError,
    );

    image.remove();
  });
});
