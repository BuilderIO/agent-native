import { describe, expect, it } from "vitest";

import type { OverviewScreen } from "./overview-screens";
import { resolveUrlScreen } from "./url-screen";

function screen(overrides: Partial<OverviewScreen> = {}): OverviewScreen {
  return {
    id: "screen-1",
    filename: "home.html",
    content: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
    heightPinned: false,
    ...overrides,
  };
}

describe("resolveUrlScreen", () => {
  it("is null without a screen or for a markup screen", () => {
    expect(
      resolveUrlScreen({ screen: null, fallbackSourceType: "inline" }),
    ).toBeNull();
    expect(
      resolveUrlScreen({
        screen: screen({ sourceType: "inline", content: "<div></div>" }),
        fallbackSourceType: "inline",
      }),
    ).toBeNull();
  });

  it("describes a URL screen by its route and the page Open in browser lands on", () => {
    const result = resolveUrlScreen({
      screen: screen({
        sourceType: "localhost",
        url: "http://localhost:3000/pricing?plan=pro#faq",
      }),
      fallbackSourceType: "inline",
    });

    expect(result).toEqual({
      title: "Home",
      route: "/pricing?plan=pro",
      url: "http://localhost:3000/pricing?plan=pro#faq",
      openUrl: "http://localhost:3000/pricing?plan=pro#faq",
    });
  });

  it("names the page by the screen's title, falling back to its file", () => {
    const named = resolveUrlScreen({
      screen: screen({
        sourceType: "localhost",
        title: "Pricing page",
        url: "http://localhost:3000/pricing",
      }),
      fallbackSourceType: "inline",
    });
    expect(named?.title).toBe("Pricing page");
  });

  it("follows the running app: the live route replaces the URL's path in both", () => {
    const result = resolveUrlScreen({
      screen: screen({
        sourceType: "localhost",
        url: "http://localhost:3000/",
      }),
      fallbackSourceType: "inline",
      liveRoutePath: "/docs/start",
    });

    expect(result?.route).toBe("/docs/start");
    expect(result?.openUrl).toBe("http://localhost:3000/docs/start");
  });

  it("reads a URL screen from the design's source type and from its content", () => {
    const result = resolveUrlScreen({
      screen: screen({ content: " https://example.com/home " }),
      fallbackSourceType: "localhost",
    });

    expect(result).toMatchObject({
      url: "https://example.com/home",
      route: "/home",
      openUrl: "https://example.com/home",
    });
  });

  it("offers nothing to open when the URL is not an http(s) page", () => {
    const result = resolveUrlScreen({
      screen: screen({ sourceType: "localhost", url: "file:///tmp/app.html" }),
      fallbackSourceType: "inline",
    });

    expect(result?.openUrl).toBeNull();
  });

  it("offers nothing to open for an unparseable URL, and keeps the screen's own route", () => {
    const result = resolveUrlScreen({
      screen: screen({ sourceType: "localhost", url: "not a url" }),
      fallbackSourceType: "inline",
    });

    expect(result).toMatchObject({ route: "/home", openUrl: null });
  });

  it("is null for a URL screen with no URL", () => {
    expect(
      resolveUrlScreen({
        screen: screen({ sourceType: "localhost", content: "" }),
        fallbackSourceType: "inline",
      }),
    ).toBeNull();
  });
});
