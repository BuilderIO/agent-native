// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertRemoteImagesCapturable,
  crossOriginImageUrls,
  ReplayScreenshotAssetError,
} from "./session-replay-screenshot";

afterEach(() => {
  vi.restoreAllMocks();
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
      ]),
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
        "https://assets.example.test/nested.png",
      ]),
    );

    svg.remove();
  });

  it("rejects nested frames whose assets cannot be inspected", () => {
    const frame = {
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
});
