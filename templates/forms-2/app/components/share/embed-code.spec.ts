import { describe, expect, it } from "vitest";

import {
  DEFAULT_EMBED_OPTIONS,
  embedCode,
  embedQuery,
  embedUrl,
} from "./embed-code";

const origin = "https://forms.example.test";

describe("embed code", () => {
  it("writes only the options that are on", () => {
    expect(embedQuery("standard", DEFAULT_EMBED_OPTIONS)).toBe(
      "alignLeft=1&hideTitle=1&transparentBackground=1&dynamicHeight=1",
    );
    const off = { ...DEFAULT_EMBED_OPTIONS, hideTitle: false };
    expect(embedUrl(origin, "f1", "standard", off)).not.toContain("hideTitle");
  });

  it("keeps tracking out of the preview URL", () => {
    const on = { ...DEFAULT_EMBED_OPTIONS, trackEvents: true };
    expect(embedUrl(origin, "f1", "standard", on)).toContain("trackEvents=1");
    expect(
      embedUrl(origin, "f1", "standard", on, { withoutTracking: true }),
    ).not.toContain("trackEvents");
  });

  it("builds an iframe, a popup trigger and a full-page document", () => {
    const standard = embedCode(origin, "f1", "standard", DEFAULT_EMBED_OPTIONS);
    expect(standard).toContain('<iframe data-forms-embed="f1"');
    expect(standard).toContain(`${origin}/forms-embed.js`);
    const fixed = { ...DEFAULT_EMBED_OPTIONS, dynamicHeight: false };
    expect(embedCode(origin, "f1", "standard", fixed)).not.toContain("<script");

    const popup = embedCode(origin, "f1", "popup", DEFAULT_EMBED_OPTIONS);
    expect(popup).toContain('data-forms-popup="f1"');
    expect(popup).toContain("<button");
    const onLoad = { ...DEFAULT_EMBED_OPTIONS, trigger: "load" as const };
    expect(embedCode(origin, "f1", "popup", onLoad)).toContain("<div");

    const page = embedCode(origin, "f1", "fullPage", DEFAULT_EMBED_OPTIONS);
    expect(page).toContain("position: absolute");
    expect(page).toContain(`${origin}/embed/f1?transparentBackground=1`);
  });
});
