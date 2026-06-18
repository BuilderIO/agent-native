// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { planNavigateCommandPath } from "./use-navigation-state";

describe("planNavigateCommandPath", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers a command URL path over semantic fallback fields", () => {
    expect(
      planNavigateCommandPath({
        view: "plans",
        path: "/plans/plan-123",
      }),
    ).toBe("/plans/plan-123");
  });

  it("strips the router basename from same-origin command URLs", () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/acme");

    expect(
      planNavigateCommandPath({
        view: "plans",
        path: "http://localhost:3000/acme/plans/plan-123?tab=diff",
      }),
    ).toBe("/plans/plan-123?tab=diff");
  });

  it("normalizes exact and repeated basename command paths", () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/acme");

    expect(
      planNavigateCommandPath({
        view: "plans",
        path: "/acme?x=1#top",
      }),
    ).toBe("/?x=1#top");
    expect(
      planNavigateCommandPath({
        view: "plans",
        path: "/acme/acme/recaps/recap-123",
      }),
    ).toBe("/recaps/recap-123");
  });

  it("falls back to semantic navigation when the URL is not local", () => {
    expect(
      planNavigateCommandPath({
        view: "plan",
        planId: "plan-123",
        path: "https://example.com/plans/plan-123",
      }),
    ).toBe("/plans/plan-123");
  });
});
