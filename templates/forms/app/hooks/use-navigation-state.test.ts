// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { formsNavigateCommandPath } from "./use-navigation-state";

describe("formsNavigateCommandPath", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("routes semantic ask and home commands to the Ask tab", () => {
    expect(formsNavigateCommandPath({ view: "ask" })).toBe("/ask");
    expect(formsNavigateCommandPath({ view: "home" })).toBe("/ask");
  });

  it("prefers a command URL path over semantic fallback fields", () => {
    expect(
      formsNavigateCommandPath({
        view: "home",
        path: "/forms/CSVP7Bz6dC?tab=edit",
      }),
    ).toBe("/forms/CSVP7Bz6dC?tab=edit");
  });

  it("accepts same-origin absolute URLs", () => {
    expect(
      formsNavigateCommandPath({
        view: "home",
        url: "http://localhost:3000/forms/CSVP7Bz6dC?tab=settings",
      }),
    ).toBe("/forms/CSVP7Bz6dC?tab=settings");
  });

  it("strips the router basename from command paths", () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/acme");

    expect(
      formsNavigateCommandPath({
        view: "home",
        path: "/acme/forms/CSVP7Bz6dC?tab=edit",
      }),
    ).toBe("/forms/CSVP7Bz6dC?tab=edit");
  });

  it("strips the router basename from same-origin command URLs", () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/acme");

    expect(
      formsNavigateCommandPath({
        view: "home",
        url: "http://localhost:3000/acme/forms/CSVP7Bz6dC?tab=settings",
      }),
    ).toBe("/forms/CSVP7Bz6dC?tab=settings");
  });

  it("normalizes exact and repeated basename command paths", () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/acme");

    expect(
      formsNavigateCommandPath({
        view: "home",
        path: "/acme?x=1#top",
      }),
    ).toBe("/?x=1#top");
    expect(
      formsNavigateCommandPath({
        view: "home",
        path: "/acme/acme/forms/CSVP7Bz6dC",
      }),
    ).toBe("/forms/CSVP7Bz6dC");
  });

  it("falls back to semantic navigation when the URL is not local", () => {
    expect(
      formsNavigateCommandPath({
        view: "form",
        formId: "CSVP7Bz6dC",
        tab: "responses",
        url: "https://example.com/forms/CSVP7Bz6dC",
      }),
    ).toBe("/forms/CSVP7Bz6dC?tab=responses");
  });
});
