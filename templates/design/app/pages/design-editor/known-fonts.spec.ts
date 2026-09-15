// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { ensureGoogleFontLinkInHtml } from "./code-layer-state";

describe("known font references in saved screen HTML", () => {
  it("persists the pinned Lato Medium face once without loading custom names", () => {
    const html =
      "<!doctype html><html><head><title>Card</title></head><body><h1>Title</h1></body></html>";
    const once = ensureGoogleFontLinkInHtml(html, "'Lato', sans-serif");
    const parsed = new DOMParser().parseFromString(once, "text/html");
    const mediumStyle = parsed.querySelector(
      'style[data-agent-native-font-face="Lato-500"]',
    );

    expect(
      parsed.querySelector(
        'link[rel="stylesheet"][href^="https://fonts.googleapis.com/css2?family=Lato"]',
      ),
    ).not.toBeNull();
    expect(mediumStyle?.textContent).toContain("font-weight: 500");
    expect(mediumStyle?.textContent).toContain(
      "https://raw.githubusercontent.com/google/fonts/809e4d8b8d7e9364a914909bb777679606c178b8/ofl/lato/Lato-Medium.ttf",
    );
    expect(mediumStyle?.textContent).toContain("SIL Open Font License 1.1");

    const repeated = ensureGoogleFontLinkInHtml(once, "Lato, sans-serif");
    const reparsed = new DOMParser().parseFromString(repeated, "text/html");
    expect(
      reparsed.querySelectorAll(
        'style[data-agent-native-font-face="Lato-500"]',
      ),
    ).toHaveLength(1);
    expect(
      reparsed.querySelectorAll(
        'link[rel="stylesheet"][href^="https://fonts.googleapis.com/css2?family=Lato"]',
      ),
    ).toHaveLength(1);
    expect(
      ensureGoogleFontLinkInHtml(html, '"Custom Display", sans-serif'),
    ).toBe(html);
  });
});
