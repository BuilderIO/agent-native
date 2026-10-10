// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

const { html2canvasMock } = vi.hoisted(() => ({ html2canvasMock: vi.fn() }));
vi.mock("html2canvas-pro", () => ({ default: html2canvasMock }));

import {
  assertReplayFontsReady,
  assertRemoteImagesCapturable,
  completeReplayScreenshotCapture,
  crossOriginImageUrls,
  downloadReplayScreenshot,
  inlineReplayAssets,
  ReplayScreenshotAssetError,
  ReplayScreenshotClipboardError,
  writeReplayScreenshotToClipboard,
} from "./session-replay-screenshot";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  html2canvasMock.mockReset();
  vi.useRealTimers();
  document.body.replaceChildren();
});

function pngBlob(width = 1, height = 1, animated = false): Blob {
  const bytes = new Uint8Array(animated ? 65 : 45);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0, 0, 0, 13], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  bytes.set(
    [
      (width >>> 24) & 255,
      (width >>> 16) & 255,
      (width >>> 8) & 255,
      width & 255,
      (height >>> 24) & 255,
      (height >>> 16) & 255,
      (height >>> 8) & 255,
      height & 255,
    ],
    16,
  );
  if (animated) {
    bytes.set([0, 0, 0, 8, 0x61, 0x63, 0x54, 0x4c], 33);
  }
  return new Blob([bytes], { type: "image/png" });
}

async function dataPng(width = 1, height = 1): Promise<string> {
  const bytes = new Uint8Array(await pngBlob(width, height).arrayBuffer());
  return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
}

function markMatchingElements(
  original: Document,
  cloned: Document,
  captureId: string,
) {
  const originalElements = [...original.querySelectorAll("*")];
  const clonedElements = [...cloned.querySelectorAll("*")];
  for (const [index, element] of originalElements.entries()) {
    const marker = `${captureId}-0-${index}`;
    element.setAttribute("data-replay-screenshot-map", marker);
    clonedElements[index]?.setAttribute("data-replay-screenshot-map", marker);
  }
}

function stubImageProbes(
  request: (
    url: string,
  ) => "load" | "error" | Response | Promise<"load" | "error" | Response>,
) {
  const requests: Array<{
    credentials: RequestCredentials | undefined;
    mode: RequestMode | undefined;
    signal: AbortSignal | undefined;
    url: string;
  }> = [];
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() })),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const signal = init?.signal as AbortSignal | undefined;
      requests.push({
        credentials: init?.credentials,
        mode: init?.mode,
        signal,
        url,
      });
      return new Promise<Response>((resolve, reject) => {
        const abort = () => reject(new DOMException("Aborted", "AbortError"));
        if (signal?.aborted) {
          abort();
          return;
        }
        signal?.addEventListener("abort", abort, { once: true });
        Promise.resolve(request(url)).then((result) => {
          signal?.removeEventListener("abort", abort);
          if (result instanceof Response) {
            resolve(result);
          } else if (result === "error") {
            resolve(new Response(null, { status: 503 }));
          } else {
            resolve(
              new Response(pngBlob(), {
                headers: { "content-type": "image/png" },
              }),
            );
          }
        }, reject);
      });
    }),
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/png;base64,c2NyZWVuc2hvdA==",
  );
  return requests;
}

function appendNestedReplayFrames(depth: number): Document {
  let parent = document;
  let deepest = document;
  for (let index = 0; index < depth; index += 1) {
    const child = document.implementation.createHTMLDocument();
    const frame = parent.createElement("iframe");
    Object.defineProperty(frame, "contentDocument", {
      configurable: true,
      value: child,
    });
    parent.body.appendChild(frame);
    parent = child;
    deepest = child;
  }
  return deepest;
}

describe("session replay screenshot asset checks", () => {
  it("finds remote images in pseudo-element content, backgrounds, and list styles", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (_element, pseudo) =>
        ({
          backgroundImage:
            pseudo === "::before"
              ? 'url("https://assets.example.test/before.png")'
              : "none",
          maskImage: "none",
          listStyleImage:
            pseudo == null
              ? 'url("https://assets.example.test/list-style.png")'
              : "none",
          content:
            pseudo === "::after"
              ? 'url("https://assets.example.test/after-content.png")'
              : pseudo === "::before"
                ? '""'
                : "none",
          display: "block",
          visibility: "visible",
          opacity: "1",
          borderImageSource: "none",
        }) as unknown as CSSStyleDeclaration,
    );

    expect(crossOriginImageUrls(document)).toEqual(
      expect.arrayContaining([
        "https://assets.example.test/before.png",
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
        }) as unknown as CSSStyleDeclaration,
    );

    expect(crossOriginImageUrls(document)).toEqual(
      expect.arrayContaining([
        "https://assets.example.test/root-background.png",
        "https://assets.example.test/root-content.png",
      ]),
    );
  });

  it("finds CSS image URLs and image-submit sources", () => {
    const input = document.createElement("input");
    input.type = "image";
    input.src = "https://assets.example.test/submit.png";
    document.body.appendChild(input);
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (_element, pseudo) =>
        ({
          backgroundImage:
            pseudo == null
              ? 'url("https://assets.example.test/one.png"), url("https://assets.example.test/two.png")'
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

  it("finds remote images in open shadow roots", () => {
    const host = document.createElement("section");
    const shadowRoot = host.attachShadow({ mode: "open" });
    const image = document.createElement("img");
    image.src = "https://assets.example.test/shadow.png";
    shadowRoot.appendChild(image);
    document.body.appendChild(host);

    expect(crossOriginImageUrls(document)).toContain(
      "https://assets.example.test/shadow.png",
    );

    host.remove();
  });

  it("parses quoted CSS image URLs containing parentheses", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (_element, pseudo) =>
        ({
          backgroundImage:
            pseudo == null
              ? 'url("https://assets.example.test/image(1).png")'
              : "none",
          maskImage: "none",
          listStyleImage: "none",
          content: "none",
        }) as CSSStyleDeclaration,
    );

    expect(crossOriginImageUrls(document)).toContain(
      "https://assets.example.test/image(1).png",
    );

    element.remove();
  });

  it("finds remote SVG images and images in accessible child frames", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const svgImage = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "image",
    );
    svgImage.setAttribute("href", "https://assets.example.test/inline.svg");
    svg.appendChild(svgImage);
    const childDocument = document.implementation.createHTMLDocument();
    const nestedAsset = childDocument.createElement("div");
    nestedAsset.style.backgroundImage =
      "url(https://assets.example.test/nested.png)";
    childDocument.body.appendChild(nestedAsset);
    const frame = document.createElement("iframe");
    Object.defineProperty(frame, "contentDocument", {
      configurable: true,
      value: childDocument,
    });
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
    document.body.append(svg, frame);

    expect(() => crossOriginImageUrls(document)).toThrow(
      ReplayScreenshotAssetError,
    );

    svg.remove();
    expect(crossOriginImageUrls(document)).toContain(
      "https://assets.example.test/nested.png",
    );
    frame.remove();
  });

  it("ignores external images in hidden elements", () => {
    const hidden = document.createElement("div");
    hidden.style.display = "none";
    hidden.innerHTML =
      '<img src="https://assets.example.test/hidden.png"><span></span>';
    document.body.appendChild(hidden);
    const visible = document.createElement("img");
    visible.src = "https://assets.example.test/visible.png";
    document.body.appendChild(visible);

    expect(crossOriginImageUrls(document)).toContain(
      "https://assets.example.test/visible.png",
    );
    expect(crossOriginImageUrls(document)).not.toContain(
      "https://assets.example.test/hidden.png",
    );

    hidden.remove();
    visible.remove();
  });

  it("keeps visible descendants when an ancestor hides visibility", () => {
    const hidden = document.createElement("div");
    hidden.style.visibility = "hidden";
    const visible = document.createElement("img");
    visible.style.visibility = "visible";
    visible.src = "https://assets.example.test/visible-descendant.png";
    Object.defineProperty(visible, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 80,
        height: 40,
        left: 10,
        right: 80,
        top: 40,
        width: 70,
      }),
    });
    hidden.appendChild(visible);
    document.body.appendChild(hidden);
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element) =>
        ({
          display: "block",
          visibility:
            element === hidden
              ? "hidden"
              : (element as HTMLElement).style.visibility || "visible",
          contentVisibility: "visible",
          opacity: "1",
        }) as CSSStyleDeclaration,
    );

    expect(crossOriginImageUrls(document)).toContain(
      "https://assets.example.test/visible-descendant.png",
    );

    hidden.remove();
  });

  it("rejects CSS image-set and mask visuals that html2canvas cannot preserve", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (_element, pseudo) =>
        ({
          backgroundImage:
            pseudo == null
              ? 'image-set("https://assets.example.test/one.png" 1x)'
              : "none",
          listStyleImage: "none",
          maskImage: "none",
          borderImageSource: "none",
          visibility: "visible",
          display: "block",
          content: "none",
          getPropertyValue: () => "none",
        }) as unknown as CSSStyleDeclaration,
    );

    expect(() => crossOriginImageUrls(document)).toThrow(
      ReplayScreenshotAssetError,
    );
    vi.restoreAllMocks();
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      backgroundImage: "none",
      listStyleImage: "none",
      maskImage: 'url("https://assets.example.test/mask.png")',
      borderImageSource: "none",
      visibility: "visible",
      display: "block",
      content: "none",
      getPropertyValue: () => "none",
    } as unknown as CSSStyleDeclaration);
    expect(() => crossOriginImageUrls(document)).toThrow(
      ReplayScreenshotAssetError,
    );

    element.remove();
  });

  it("rejects visible tainted canvases", () => {
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 80,
        height: 40,
        left: 10,
        right: 80,
        top: 40,
        width: 70,
      }),
    });
    document.body.appendChild(canvas);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: () => {
        throw new DOMException("Canvas is tainted", "SecurityError");
      },
      getImageData: vi.fn(),
    } as unknown as CanvasRenderingContext2D);

    expect(() => crossOriginImageUrls(document)).toThrow(
      ReplayScreenshotAssetError,
    );

    canvas.remove();
  });

  it("rejects visible canvases with oversized backing stores before reading them", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 9_000;
    canvas.height = 1;
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 80,
        height: 40,
        left: 10,
        right: 80,
        top: 40,
        width: 70,
      }),
    });
    document.body.appendChild(canvas);
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext");

    await expect(assertRemoteImagesCapturable(document)).rejects.toBeInstanceOf(
      ReplayScreenshotAssetError,
    );
    expect(getContext).not.toHaveBeenCalled();

    canvas.remove();
  });

  it("rejects excessive replay image resources before starting fetches", async () => {
    for (let index = 0; index < 129; index += 1) {
      const image = document.createElement("img");
      image.src = `https://assets.example.test/${index}.png`;
      document.body.appendChild(image);
    }
    const requests = stubImageProbes(() => "load");

    await expect(assertRemoteImagesCapturable(document)).rejects.toBeInstanceOf(
      ReplayScreenshotAssetError,
    );
    expect(requests).toHaveLength(0);
  });

  it("rejects visible native audio controls", () => {
    const audio = document.createElement("audio");
    audio.setAttribute("controls", "");
    Object.defineProperty(audio, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 80,
        height: 32,
        left: 10,
        right: 210,
        top: 48,
        width: 200,
      }),
    });
    document.body.appendChild(audio);
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      display: "inline",
      visibility: "visible",
      contentVisibility: "visible",
      opacity: "1",
    } as unknown as CSSStyleDeclaration);
    expect(() => crossOriginImageUrls(document)).toThrow(
      ReplayScreenshotAssetError,
    );

    audio.remove();
  });

  it("ignores external images outside the replay viewport", () => {
    const image = document.createElement("img");
    image.src = "https://assets.example.test/offscreen.png";
    Object.defineProperty(image, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 180,
        height: 80,
        left: 2_000,
        right: 2_080,
        top: 100,
        width: 80,
      }),
    });
    document.body.appendChild(image);

    expect(crossOriginImageUrls(document)).not.toContain(
      "https://assets.example.test/offscreen.png",
    );

    image.remove();
  });

  it("ignores pseudo-element images that are not rendered", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (_element, pseudo) =>
        ({
          backgroundImage:
            pseudo === "::before"
              ? 'url("https://assets.example.test/hidden-pseudo.png")'
              : "none",
          content: pseudo === "::before" ? "none" : "normal",
          display: "block",
          visibility: "visible",
          opacity: "1",
          borderImageSource: "none",
          listStyleImage: "none",
          maskImage: "none",
        }) as CSSStyleDeclaration,
    );

    expect(crossOriginImageUrls(document)).not.toContain(
      "https://assets.example.test/hidden-pseudo.png",
    );

    element.remove();
  });

  it("rejects nested frames whose assets cannot be inspected", () => {
    const frame = document.createElement("iframe");
    Object.defineProperty(frame, "contentDocument", {
      configurable: true,
      value: null,
    });
    document.body.appendChild(frame);
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      display: "block",
      visibility: "visible",
      contentVisibility: "visible",
      opacity: "1",
    } as unknown as CSSStyleDeclaration);

    expect(() => crossOriginImageUrls(document)).toThrow(
      ReplayScreenshotAssetError,
    );
    frame.remove();
  });

  it("bounds nested frame traversal before font and asset preflight", async () => {
    const deepest = appendNestedReplayFrames(8);
    const image = deepest.createElement("img");
    image.src = "https://assets.example.test/deep.png";
    deepest.body.appendChild(image);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(() => crossOriginImageUrls(document)).toThrow(
      ReplayScreenshotAssetError,
    );
    await expect(assertReplayFontsReady(document)).rejects.toBeInstanceOf(
      ReplayScreenshotAssetError,
    );
    await expect(assertRemoteImagesCapturable(document)).rejects.toBeInstanceOf(
      ReplayScreenshotAssetError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not unlock playback when a stale screenshot capture finishes", () => {
    const staleCapture = new AbortController();
    const activeCapture = new AbortController();
    const captureRef: { current: AbortController | null } = {
      current: activeCapture,
    };
    const unlockPlayback = vi.fn();

    expect(
      completeReplayScreenshotCapture(captureRef, staleCapture, unlockPlayback),
    ).toBe(false);
    expect(captureRef.current).toBe(activeCapture);
    expect(unlockPlayback).not.toHaveBeenCalled();

    expect(
      completeReplayScreenshotCapture(
        captureRef,
        activeCapture,
        unlockPlayback,
      ),
    ).toBe(true);
    expect(captureRef.current).toBeNull();
    expect(unlockPlayback).toHaveBeenCalledOnce();
  });

  it("allows readable current video frames", async () => {
    const video = document.createElement("video");
    Object.defineProperty(video, "currentSrc", {
      configurable: true,
      value: "https://assets.example.test/recording.mp4",
    });
    Object.defineProperty(video, "readyState", {
      configurable: true,
      value: 2,
    });
    Object.defineProperty(video, "videoWidth", {
      configurable: true,
      value: 640,
    });
    Object.defineProperty(video, "videoHeight", {
      configurable: true,
      value: 480,
    });
    const drawImage = vi.fn();
    const getImageData = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
      getImageData,
    } as unknown as CanvasRenderingContext2D);
    document.body.appendChild(video);

    await expect(assertRemoteImagesCapturable(document)).resolves.toEqual(
      new Map(),
    );
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 1, 1);
    expect(getImageData).toHaveBeenCalledWith(0, 0, 1, 1);

    video.remove();
  });

  it("rejects unreadable video frames and preflights a poster fallback", async () => {
    const videoFrame = document.createElement("video");
    Object.defineProperty(videoFrame, "currentSrc", {
      configurable: true,
      value: "https://assets.example.test/recording.mp4",
    });
    Object.defineProperty(videoFrame, "readyState", {
      configurable: true,
      value: 2,
    });
    Object.defineProperty(videoFrame, "videoWidth", {
      configurable: true,
      value: 640,
    });
    Object.defineProperty(videoFrame, "videoHeight", {
      configurable: true,
      value: 480,
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
      getImageData: () => {
        throw new DOMException("Tainted video", "SecurityError");
      },
    } as unknown as CanvasRenderingContext2D);
    document.body.appendChild(videoFrame);
    await expect(assertRemoteImagesCapturable(document)).rejects.toBeInstanceOf(
      ReplayScreenshotAssetError,
    );
    videoFrame.remove();

    const video = document.createElement("video");
    video.poster = "https://assets.example.test/poster.png";
    document.body.appendChild(video);
    expect(crossOriginImageUrls(document)).toContain(video.poster);
    stubImageProbes(() => "load");
    const assets = await assertRemoteImagesCapturable(document);
    expect(assets.get(document)?.get(video.poster)).toMatch(/^data:image\/png/);
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

  it("replaces a poster-only video with its preflighted image in the clone", async () => {
    const original = document.implementation.createHTMLDocument("original");
    const cloned = document.implementation.createHTMLDocument("cloned");
    const video = original.createElement("video");
    video.poster = "https://assets.example.test/poster.png";
    original.body.appendChild(video);
    cloned.body.appendChild(cloned.createElement("video"));
    markMatchingElements(original, cloned, "replay-poster");

    stubImageProbes(() => "load");
    const assets = await assertRemoteImagesCapturable(original);
    inlineReplayAssets(original, cloned, assets, "replay-poster");

    expect(cloned.querySelector("video")).toBeNull();
    expect(cloned.querySelector("img")?.src).toMatch(/^data:image\/png/);
  });

  it("accepts html2canvas's canvas clone for a readable video frame", () => {
    const original = document.implementation.createHTMLDocument("original");
    const cloned = document.implementation.createHTMLDocument("cloned");
    const video = original.createElement("video");
    Object.defineProperty(video, "readyState", {
      configurable: true,
      value: 2,
    });
    Object.defineProperty(video, "videoWidth", {
      configurable: true,
      value: 320,
    });
    Object.defineProperty(video, "videoHeight", {
      configurable: true,
      value: 180,
    });
    original.body.appendChild(video);
    const canvas = cloned.createElement("canvas");
    cloned.body.appendChild(canvas);
    markMatchingElements(original, cloned, "replay-video-canvas");
    canvas.removeAttribute("data-replay-screenshot-map");

    expect(() =>
      inlineReplayAssets(original, cloned, new Map(), "replay-video-canvas"),
    ).not.toThrow();
    expect(cloned.querySelector("canvas")).not.toBeNull();
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

  it("finishes reconstructed document parsing before waiting for fonts", async () => {
    const fontsDescriptor = Object.getOwnPropertyDescriptor(document, "fonts");
    let resolveFonts: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      resolveFonts = resolve;
    });
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready },
    });
    vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    const close = vi.spyOn(document, "close").mockImplementation(resolveFonts);
    try {
      await assertReplayFontsReady(document);
      expect(close).toHaveBeenCalledOnce();
    } finally {
      if (fontsDescriptor) {
        Object.defineProperty(document, "fonts", fontsDescriptor);
      } else {
        Reflect.deleteProperty(document, "fonts");
      }
    }
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
      const rejection = pending.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(8_000);
      const error = await rejection;
      expect(error).toBeInstanceOf(ReplayScreenshotAssetError);
      expect(error).toMatchObject({ reason: "fontReadiness" });
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
    const frame = document.createElement("iframe");
    Object.defineProperty(frame, "contentDocument", {
      configurable: true,
      value: childDocument,
    });
    document.body.appendChild(frame);
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      display: "block",
      visibility: "visible",
      contentVisibility: "visible",
      opacity: "1",
    } as CSSStyleDeclaration);

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
    frame.remove();
  });

  it("times out image checks instead of waiting indefinitely", async () => {
    vi.useFakeTimers();
    const image = document.createElement("img");
    image.src = "https://assets.example.test/slow.png";
    document.body.appendChild(image);
    stubImageProbes(() => new Promise(() => {}));

    const pending = assertRemoteImagesCapturable(document);
    const rejection = expect(pending).rejects.toBeInstanceOf(
      ReplayScreenshotAssetError,
    );
    await vi.advanceTimersByTimeAsync(8_000);
    await rejection;

    image.remove();
  });

  it("skips same-document SVG fragment references", async () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const svgUse = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "use",
    );
    svgUse.setAttribute("href", "#icon");
    svg.appendChild(svgUse);
    document.body.appendChild(svg);
    stubImageProbes(() => "load");

    await expect(
      assertRemoteImagesCapturable(document),
    ).resolves.toBeInstanceOf(Map);

    svg.remove();
  });

  it("uses bounded CORS fetches and inlines raster assets", async () => {
    const image = document.createElement("img");
    image.src = "https://assets.example.test/image.png";
    document.body.appendChild(image);
    const probes = stubImageProbes(() => "load");

    const assets = await assertRemoteImagesCapturable(document);

    expect(probes).toHaveLength(1);
    expect(probes[0]).toMatchObject({
      credentials: "same-origin",
      mode: "cors",
      url: image.src,
    });
    expect(assets.get(document)?.get(image.src)).toMatch(/^data:image\/png/);

    image.remove();
  });

  it("can preflight replay assets without browser credentials", async () => {
    const image = document.createElement("img");
    image.src = "https://assets.example.test/image.png";
    document.body.appendChild(image);
    const probes = stubImageProbes(() => "load");

    await assertRemoteImagesCapturable(document, undefined, "omit");

    expect(probes).toHaveLength(1);
    expect(probes[0]).toMatchObject({
      credentials: "omit",
      mode: "cors",
      url: image.src,
    });
    image.remove();
  });

  it("preflights inline image data and checks its dimensions", async () => {
    const image = document.createElement("img");
    image.src = await dataPng(4_000, 3_000);
    document.body.appendChild(image);
    const probes = stubImageProbes(
      () =>
        new Response(pngBlob(4_000, 3_000), {
          headers: { "content-type": "image/png" },
        }),
    );
    const decode = vi.mocked(globalThis.createImageBitmap);

    await expect(assertRemoteImagesCapturable(document)).rejects.toBeInstanceOf(
      ReplayScreenshotAssetError,
    );
    expect(probes).toHaveLength(1);
    expect(decode).not.toHaveBeenCalled();

    image.remove();
  });

  it("preflights inline image data with uppercase media types", async () => {
    const image = document.createElement("img");
    image.src = (await dataPng(4_000, 3_000)).replace(
      "data:image/",
      "DATA:IMAGE/",
    );
    document.body.appendChild(image);
    const probes = stubImageProbes(
      () =>
        new Response(pngBlob(4_000, 3_000), {
          headers: { "content-type": "image/png" },
        }),
    );

    await expect(assertRemoteImagesCapturable(document)).rejects.toBeInstanceOf(
      ReplayScreenshotAssetError,
    );
    expect(probes).toHaveLength(1);

    image.remove();
  });

  it("checks image dimensions before decoding large raster assets", async () => {
    const image = document.createElement("img");
    image.src = "https://assets.example.test/large.png";
    document.body.appendChild(image);
    stubImageProbes(
      () =>
        new Response(pngBlob(4_000, 3_000), {
          headers: { "content-type": "image/png" },
        }),
    );
    const decode = vi.mocked(globalThis.createImageBitmap);

    await expect(assertRemoteImagesCapturable(document)).rejects.toBeInstanceOf(
      ReplayScreenshotAssetError,
    );
    expect(decode).not.toHaveBeenCalled();

    image.remove();
  });

  it("rejects animated PNGs instead of inlining a stale frame", async () => {
    const image = document.createElement("img");
    image.src = "https://assets.example.test/animated.png";
    document.body.appendChild(image);
    stubImageProbes(
      () =>
        new Response(pngBlob(1, 1, true), {
          headers: { "content-type": "image/png" },
        }),
    );
    const decode = vi.mocked(globalThis.createImageBitmap);

    const error = await assertRemoteImagesCapturable(document).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ReplayScreenshotAssetError);
    expect(error).toMatchObject({ reason: "unsupportedAsset" });
    expect(decode).not.toHaveBeenCalled();

    image.remove();
  });

  it("inlines a static SVG after rejecting external and animated content", async () => {
    const image = document.createElement("img");
    image.src = "https://assets.example.test/logo.svg";
    document.body.appendChild(image);
    stubImageProbes(
      () =>
        new Response(
          new Blob(
            [
              '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><defs><linearGradient id="g"/></defs><path fill="url(#g)"/></svg>',
            ],
            { type: "image/svg+xml" },
          ),
          { headers: { "content-type": "image/svg+xml" } },
        ),
    );

    const assets = await assertRemoteImagesCapturable(document);

    expect(assets.get(document)?.get(image.src)).toMatch(/^data:image\/png/);
    image.remove();
  });

  it("reports a missing cloned stage frame while capturing nested frames and cursor", async () => {
    const stage = document.createElement("div");
    stage.style.backgroundColor = "rgb(17, 34, 51)";
    const stageRoot = document.createElement("div");
    const iframe = document.createElement("iframe");
    const replayDocument = document.implementation.createHTMLDocument("replay");
    const childDocument = document.implementation.createHTMLDocument("nested");
    const replayView = {
      getComputedStyle: window.getComputedStyle.bind(window),
      HTMLIFrameElement: window.HTMLIFrameElement,
      HTMLImageElement: window.HTMLImageElement,
      HTMLInputElement: window.HTMLInputElement,
      innerHeight: 480,
      innerWidth: 640,
      scrollX: 12,
      scrollY: 34,
    };
    Object.defineProperty(replayDocument, "defaultView", {
      configurable: true,
      value: replayView,
    });
    Object.defineProperty(childDocument, "defaultView", {
      configurable: true,
      value: replayView,
    });
    const nestedFrame = replayDocument.createElement("iframe");
    Object.defineProperty(nestedFrame, "contentDocument", {
      configurable: true,
      value: childDocument,
    });
    replayDocument.body.appendChild(nestedFrame);
    Object.defineProperty(iframe, "contentDocument", {
      configurable: true,
      value: replayDocument,
    });
    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      value: { innerHeight: 480, innerWidth: 640, scrollX: 12, scrollY: 34 },
    });
    const cursor = document.createElement("div");
    cursor.className = "replayer-mouse has-position";
    stageRoot.append(iframe, cursor);
    stage.appendChild(stageRoot);
    document.body.appendChild(stage);

    const makeCanvas = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      Object.defineProperty(canvas, "toDataURL", {
        configurable: true,
        value: () => "data:image/png;base64,c2NyZWVuc2hvdA==",
      });
      Object.defineProperty(canvas, "toBlob", {
        configurable: true,
        value: (callback: BlobCallback) =>
          callback(new Blob(["png"], { type: "image/png" })),
      });
      return canvas;
    };
    const captures: Array<{
      element: HTMLElement;
      options: Record<string, any>;
    }> = [];
    let omitStageFrame = true;
    html2canvasMock.mockImplementation(
      async (element: HTMLElement, options: Record<string, any>) => {
        captures.push({ element, options });
        if (captures.length < 3) {
          const sourceDocument = element.ownerDocument;
          const clonedDocument = document.implementation.createHTMLDocument();
          const clonedRoot = sourceDocument.documentElement.cloneNode(
            true,
          ) as HTMLElement;
          clonedDocument.documentElement.innerHTML = clonedRoot.innerHTML;
          for (const attribute of Array.from(clonedRoot.attributes)) {
            clonedDocument.documentElement.setAttribute(
              attribute.name,
              attribute.value,
            );
          }
          await options.onclone?.(clonedDocument);
          if (captures.length === 2) {
            const clonedNestedFrame = clonedDocument.querySelector("img");
            expect(clonedNestedFrame?.getAttribute("src")).toBe(
              "data:image/png;base64,c2NyZWVuc2hvdA==",
            );
          }
          return makeCanvas();
        }

        const clonedStageRoot = stageRoot.cloneNode(true) as HTMLElement;
        if (omitStageFrame) clonedStageRoot.querySelector("iframe")?.remove();
        await options.onclone?.(document, clonedStageRoot);
        expect(clonedStageRoot.querySelector(".replayer-mouse")).not.toBeNull();
        expect(clonedStageRoot.querySelector("iframe")).toBeNull();
        expect(clonedStageRoot.querySelector("img")?.getAttribute("src")).toBe(
          "data:image/png;base64,c2NyZWVuc2hvdA==",
        );
        expect(clonedStageRoot.style.position).toBe("fixed");
        expect(clonedStageRoot.style.transform).toBe("none");
        expect(
          clonedStageRoot.style.getPropertyValue("--an-replay-cursor-scale"),
        ).toBe("1");
        return makeCanvas();
      },
    );
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:download");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    await expect(
      downloadReplayScreenshot(stage, stageRoot, iframe, "replay.png"),
    ).rejects.toMatchObject({ reason: "cloneStageFrame" });
    expect(captures).toHaveLength(3);

    captures.length = 0;
    html2canvasMock.mockClear();
    omitStageFrame = false;
    await downloadReplayScreenshot(stage, stageRoot, iframe, "replay.png");

    expect(captures).toHaveLength(3);
    expect(captures[0]).toMatchObject({
      element: childDocument.documentElement,
      options: expect.objectContaining({
        height: 480,
        width: 640,
        windowHeight: 480,
        windowWidth: 640,
      }),
    });
    expect(captures[1]).toMatchObject({
      element: replayDocument.documentElement,
      options: expect.objectContaining({
        height: 480,
        scrollX: 12,
        scrollY: 34,
        width: 640,
        windowHeight: 480,
        windowWidth: 640,
      }),
    });
    expect(captures[2]).toMatchObject({
      element: stageRoot,
      options: expect.objectContaining({
        backgroundColor: "rgb(17, 34, 51)",
        height: 480,
        scrollX: 0,
        scrollY: 0,
        width: 640,
        windowHeight: 480,
        windowWidth: 640,
      }),
    });
    stage.remove();
  });

  it("rejects replay viewports whose output canvas exceeds the pixel cap", async () => {
    const stage = document.createElement("div");
    const iframe = document.createElement("iframe");
    const replayDocument = document.implementation.createHTMLDocument("replay");
    Object.defineProperty(iframe, "contentDocument", {
      configurable: true,
      value: replayDocument,
    });
    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      value: { innerHeight: 3_000, innerWidth: 8_000, scrollX: 0, scrollY: 0 },
    });
    stage.appendChild(iframe);
    document.body.appendChild(stage);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    const stageRoot = document.createElement("div");
    stageRoot.appendChild(iframe);
    stage.appendChild(stageRoot);
    await expect(
      downloadReplayScreenshot(stage, stageRoot, iframe, "replay.png"),
    ).rejects.toBeInstanceOf(ReplayScreenshotAssetError);
    expect(html2canvasMock).not.toHaveBeenCalled();
    stage.remove();
  });

  it("rejects image errors such as a redirect without CORS permission", async () => {
    const image = document.createElement("img");
    image.src = "/redirected-image.png";
    document.body.appendChild(image);
    stubImageProbes((url) =>
      url.endsWith("/redirected-image.png") ? "error" : "load",
    );

    await expect(assertRemoteImagesCapturable(document)).rejects.toBeInstanceOf(
      ReplayScreenshotAssetError,
    );
    image.remove();
  });

  it("inlines same-origin image redirects after a CORS image load", async () => {
    const image = document.createElement("img");
    image.src = "/redirected-image.png";
    document.body.appendChild(image);
    stubImageProbes(() => "load");

    const assets = await assertRemoteImagesCapturable(document);
    expect(assets.get(document)?.get(image.src)).toMatch(/^data:image\/png/);

    image.remove();
  });

  it("replaces images and CSS URLs in the cloned replay document", () => {
    const original = document.implementation.createHTMLDocument("original");
    const cloned = document.implementation.createHTMLDocument("cloned");
    const originalImage = original.createElement("img");
    originalImage.src = "https://assets.example.test/photo.png";
    original.body.appendChild(originalImage);
    const originalCard = original.createElement("div");
    originalCard.style.backgroundImage =
      'url("https://assets.example.test/card.png")';
    original.body.appendChild(originalCard);
    const clonedImage = cloned.createElement("img");
    clonedImage.src = originalImage.src;
    cloned.body.appendChild(clonedImage);
    const clonedCard = cloned.createElement("div");
    clonedCard.style.backgroundImage = originalCard.style.backgroundImage;
    cloned.body.appendChild(clonedCard);
    const imageData = "data:image/png;base64,aW1hZ2U=";
    const cardData = "data:image/png;base64,Y2FyZA==";
    const captureId = "replay-test";
    markMatchingElements(original, cloned, captureId);

    inlineReplayAssets(
      original,
      cloned,
      new Map([
        [
          original,
          new Map([
            [originalImage.src, imageData],
            ["https://assets.example.test/card.png", cardData],
          ]),
        ],
      ]),
      captureId,
    );

    expect(clonedImage.getAttribute("src")).toBe(imageData);
    expect(clonedCard.style.backgroundImage).toContain(cardData);
    expect(clonedCard.style.getPropertyPriority("background-image")).toBe(
      "important",
    );
  });

  it("preserves rewritten pseudo images against stronger important rules", () => {
    const original = document.implementation.createHTMLDocument("original");
    const cloned = document.implementation.createHTMLDocument("cloned");
    const originalCard = original.createElement("div");
    originalCard.className = "card";
    original.body.appendChild(originalCard);
    const clonedCard = cloned.createElement("div");
    clonedCard.className = "card";
    cloned.body.appendChild(clonedCard);
    const captureId = "replaypseudo";
    markMatchingElements(original, cloned, captureId);
    clonedCard.classList.add("___html2canvas___pseudoelement_before");
    const pseudoElement = cloned.createElement("html2canvaspseudoelement");
    const pseudoImage = cloned.createElement("img");
    pseudoImage.src = "https://assets.example.test/pseudo.png";
    pseudoElement.appendChild(pseudoImage);
    clonedCard.appendChild(pseudoElement);
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element, pseudo) =>
        ({
          backgroundImage: "none",
          borderImageSource: "none",
          content:
            element === originalCard && pseudo === "::before"
              ? 'url("https://assets.example.test/pseudo.png")'
              : "none",
          display: "block",
          listStyleImage: "none",
          maskImage: "none",
          opacity: "1",
          visibility: "visible",
        }) as CSSStyleDeclaration,
    );

    inlineReplayAssets(
      original,
      cloned,
      new Map([
        [
          original,
          new Map([
            [
              "https://assets.example.test/pseudo.png",
              "data:image/png;base64,cGl4ZWw=",
            ],
          ]),
        ],
      ]),
      captureId,
    );

    expect(pseudoImage.getAttribute("src")).toBe(
      "data:image/png;base64,cGl4ZWw=",
    );
    expect(cloned.head.querySelector("style")).toBeNull();
  });

  it("maps original elements when the cloned document contains helper nodes", () => {
    const original = document.implementation.createHTMLDocument("original");
    const cloned = document.implementation.createHTMLDocument("cloned");
    const originalImage = original.createElement("img");
    originalImage.src = "https://assets.example.test/photo.png";
    original.body.appendChild(originalImage);
    const clonedHelper = cloned.createElement("div");
    cloned.body.appendChild(clonedHelper);
    const clonedImage = cloned.createElement("img");
    clonedImage.src = originalImage.src;
    cloned.body.appendChild(clonedImage);
    const captureId = "replay-helper";
    const originalElements = [...original.querySelectorAll("*")];
    const cloneMatches = new Map<Element, Element>([
      [original.documentElement, cloned.documentElement],
      [original.head, cloned.head],
      [
        original.head.querySelector("title")!,
        cloned.head.querySelector("title")!,
      ],
      [original.body, cloned.body],
      [originalImage, clonedImage],
    ]);
    for (const [index, element] of originalElements.entries()) {
      const marker = `${captureId}-0-${index}`;
      element.setAttribute("data-replay-screenshot-map", marker);
      cloneMatches
        .get(element)
        ?.setAttribute("data-replay-screenshot-map", marker);
    }

    inlineReplayAssets(
      original,
      cloned,
      new Map([
        [
          original,
          new Map([[originalImage.src, "data:image/png;base64,aW1hZ2U="]]),
        ],
      ]),
      captureId,
    );

    expect(clonedImage.getAttribute("src")).toBe(
      "data:image/png;base64,aW1hZ2U=",
    );
    expect(clonedHelper.hasAttribute("data-replay-screenshot-map")).toBe(false);
  });

  it("reports a missing cloned document with its specific reason", () => {
    const original = document.implementation.createHTMLDocument("original");
    const cloned = document.implementation.createHTMLDocument("cloned");
    let error: unknown;

    try {
      inlineReplayAssets(original, cloned, new Map(), "replay-missing-clone");
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ReplayScreenshotAssetError);
    expect(error).toMatchObject({ reason: "cloneDocument" });
  });

  it("ignores source helper nodes added after the replay element snapshot", () => {
    const original = document.implementation.createHTMLDocument("original");
    const cloned = document.implementation.createHTMLDocument("cloned");
    const originalCard = original.createElement("div");
    const clonedCard = cloned.createElement("div");
    original.body.appendChild(originalCard);
    cloned.body.appendChild(clonedCard);
    const captureId = "replay-source-helper";
    const originalElements = [...original.querySelectorAll("*")];
    markMatchingElements(original, cloned, captureId);

    const helperFrame = original.createElement("iframe");
    helperFrame.className = "html2canvas-container";
    original.body.appendChild(helperFrame);

    expect(() =>
      inlineReplayAssets(
        original,
        cloned,
        new Map(),
        captureId,
        new Map(),
        originalElements,
      ),
    ).not.toThrow();
  });

  it("limits parallel image checks", async () => {
    const images = Array.from({ length: 9 }, (_, index) => {
      const image = document.createElement("img");
      image.src = `https://assets.example.test/${index}.png`;
      document.body.appendChild(image);
      return image;
    });
    let active = 0;
    let maximumActive = 0;
    const probes = stubImageProbes(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return "load" as const;
    });

    await expect(
      assertRemoteImagesCapturable(document),
    ).resolves.toBeInstanceOf(Map);

    expect(probes).toHaveLength(9);
    expect(maximumActive).toBeLessThanOrEqual(4);
    images.forEach((image) => image.remove());
  });

  it("aborts in-flight image checks after the first failed asset", async () => {
    const failed = document.createElement("img");
    failed.src = "https://assets.example.test/fail.png";
    const pending = document.createElement("img");
    pending.src = "https://assets.example.test/pending.png";
    document.body.append(failed, pending);
    const probes = stubImageProbes((url) =>
      url.endsWith("/fail.png") ? "error" : new Promise(() => {}),
    );

    await expect(assertRemoteImagesCapturable(document)).rejects.toBeInstanceOf(
      ReplayScreenshotAssetError,
    );
    expect(
      probes.find((probe) => probe.url.endsWith("/pending.png"))?.signal,
    ).toBeDefined();
    expect(
      probes.find((probe) => probe.url.endsWith("/pending.png"))?.signal
        ?.aborted,
    ).toBe(true);

    failed.remove();
    pending.remove();
  });

  it("rejects when the image preflight cannot decode an asset", async () => {
    const image = document.createElement("img");
    image.src = "https://assets.example.test/cancel-fails.png";
    document.body.appendChild(image);
    stubImageProbes(() => "error");

    await expect(assertRemoteImagesCapturable(document)).rejects.toBeInstanceOf(
      ReplayScreenshotAssetError,
    );

    image.remove();
  });
});

describe("session replay screenshot clipboard", () => {
  it("writes a promise-backed PNG ClipboardItem before capture finishes", async () => {
    let itemData: Record<string, unknown> | undefined;
    vi.stubGlobal(
      "ClipboardItem",
      class {
        constructor(data: Record<string, unknown>) {
          itemData = data;
        }
      },
    );
    let resolveScreenshot!: (blob: Blob) => void;
    const screenshot = new Promise<Blob>((resolve) => {
      resolveScreenshot = resolve;
    });
    const write = vi.fn().mockResolvedValue(undefined);
    const clipboard = { write } as unknown as Pick<Clipboard, "write">;

    const copied = writeReplayScreenshotToClipboard(screenshot, clipboard);

    expect(write).toHaveBeenCalledTimes(1);
    expect(itemData).toHaveProperty("image/png");
    expect(itemData?.["image/png"]).toBeInstanceOf(Promise);
    resolveScreenshot(pngBlob());
    await copied;
    await expect(itemData?.["image/png"]).resolves.toMatchObject({
      type: "image/png",
    });
  });

  it("aborts a pending replay capture when clipboard writing fails", async () => {
    vi.stubGlobal(
      "ClipboardItem",
      class {
        constructor(_data: Record<string, unknown>) {}
      },
    );
    const capture = new AbortController();
    const onClipboardWriteFailure = vi.fn(() => capture.abort());
    const screenshot = new Promise<Blob>((_resolve, reject) => {
      capture.signal.addEventListener(
        "abort",
        () => reject(capture.signal.reason),
        { once: true },
      );
    });

    await expect(
      writeReplayScreenshotToClipboard(
        screenshot,
        {
          write: vi.fn().mockRejectedValue(new Error("clipboard denied")),
        } as unknown as Clipboard,
        onClipboardWriteFailure,
      ),
    ).rejects.toBeInstanceOf(ReplayScreenshotClipboardError);
    expect(onClipboardWriteFailure).toHaveBeenCalledTimes(1);
    expect(capture.signal.aborted).toBe(true);
  });

  it("rejects when clipboard writing is unavailable or fails", async () => {
    vi.stubGlobal(
      "ClipboardItem",
      class {
        constructor(_data: Record<string, unknown>) {}
      },
    );

    await expect(
      writeReplayScreenshotToClipboard(pngBlob(), {} as Clipboard),
    ).rejects.toBeInstanceOf(ReplayScreenshotClipboardError);
    await expect(
      writeReplayScreenshotToClipboard(pngBlob(), {
        write: vi.fn().mockRejectedValue(new Error("clipboard denied")),
      } as unknown as Clipboard),
    ).rejects.toBeInstanceOf(ReplayScreenshotClipboardError);
    const unsupportedAssets = new ReplayScreenshotAssetError();
    await expect(
      writeReplayScreenshotToClipboard(Promise.reject(unsupportedAssets), {
        write: vi.fn().mockRejectedValue(new Error("clipboard denied")),
      } as unknown as Clipboard),
    ).rejects.toBeInstanceOf(ReplayScreenshotClipboardError);
    const unavailableClipboardAssets = new ReplayScreenshotAssetError();
    await expect(
      writeReplayScreenshotToClipboard(
        Promise.reject(unavailableClipboardAssets),
        {} as Clipboard,
      ),
    ).rejects.toBeInstanceOf(ReplayScreenshotClipboardError);
  });
});
