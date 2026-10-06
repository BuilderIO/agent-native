// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { crossOriginImageUrls } from "./session-replay-screenshot";

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
});
