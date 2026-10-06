// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertReplayFontsReady,
  assertRemoteImagesCapturable,
  crossOriginImageUrls,
  inlineReplayAssets,
  ReplayScreenshotAssetError,
} from "./session-replay-screenshot";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.replaceChildren();
});

function stubImageProbes(
  request: (url: string) => "load" | "error" | Promise<"load" | "error">,
) {
  const probes: HTMLImageElement[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/png;base64,c2NyZWVuc2hvdA==",
  );
  vi.spyOn(HTMLImageElement.prototype, "src", "set").mockImplementation(
    function (this: HTMLImageElement, value: string) {
      probes.push(this);
      Promise.resolve(request(value)).then((result) => {
        if (result === "error") {
          this.onerror?.call(this, new Event("error"));
          return;
        }
        Object.defineProperties(this, {
          naturalWidth: { configurable: true, value: 1 },
          naturalHeight: { configurable: true, value: 1 },
        });
        this.onload?.call(this, new Event("load"));
      });
    },
  );
  return probes;
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

    expect(() => crossOriginImageUrls(document)).toThrow(
      ReplayScreenshotAssetError,
    );

    svg.remove();
    expect(crossOriginImageUrls(document)).toContain(
      "https://assets.example.test/nested.png",
    );
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
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      display: "block",
      visibility: "visible",
      contentVisibility: "visible",
      opacity: "1",
    } as unknown as CSSStyleDeclaration);

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
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(
      assertRemoteImagesCapturable(document),
    ).resolves.toBeInstanceOf(Map);
    expect(fetchSpy).not.toHaveBeenCalled();

    svg.remove();
  });

  it("uses CORS image loading rather than fetch for asset checks", async () => {
    const image = document.createElement("img");
    image.src = "https://assets.example.test/image.png";
    document.body.appendChild(image);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const probes = stubImageProbes(() => "load");

    const assets = await assertRemoteImagesCapturable(document);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(probes).toHaveLength(1);
    expect(probes[0].crossOrigin).toBe("anonymous");
    expect(assets.get(document)?.get(image.src)).toMatch(/^data:image\/png/);

    image.remove();
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
    );

    expect(clonedImage.getAttribute("src")).toBe(imageData);
    expect(clonedCard.style.backgroundImage).toContain(cardData);
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
    const removeAttributeSpy = vi.spyOn(
      HTMLImageElement.prototype,
      "removeAttribute",
    );
    stubImageProbes((url) =>
      url.endsWith("/fail.png") ? "error" : new Promise(() => {}),
    );

    await expect(assertRemoteImagesCapturable(document)).rejects.toBeInstanceOf(
      ReplayScreenshotAssetError,
    );
    expect(removeAttributeSpy).toHaveBeenCalledWith("src");

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
