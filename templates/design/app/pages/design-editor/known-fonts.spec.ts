// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import {
  ensureGoogleFontLinkInHtml,
  ensureUploadedFontFaceInHtml,
} from "./code-layer-state";

describe("known font references in saved screen HTML", () => {
  it("persists known Google fonts once without loading custom names", () => {
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

    const montserrat = ensureGoogleFontLinkInHtml(
      html,
      "'Montserrat', sans-serif",
    );
    expect(montserrat).toContain("family=Montserrat:ital,wght@0,100..900");
  });

  it("persists an uploaded face once with its weight and source URL", () => {
    const html = "<!doctype html><html><head></head><body></body></html>";
    const font = {
      family: "Brand Sans",
      url: "https://cdn.example.com/brand-sans.woff2",
      weight: "400",
      style: "normal" as const,
      format: "woff2" as const,
    };
    const once = ensureUploadedFontFaceInHtml(html, font);
    const twice = ensureUploadedFontFaceInHtml(once, font);
    const parsed = new DOMParser().parseFromString(twice, "text/html");
    expect(
      parsed.querySelectorAll('style[data-agent-native-uploaded-font="true"]'),
    ).toHaveLength(1);
    expect(parsed.querySelector("style")?.textContent).toContain(
      'font-family: "Brand Sans"',
    );
    expect(parsed.querySelector("style")?.textContent).toContain(
      "brand-sans.woff2",
    );
  });
});
