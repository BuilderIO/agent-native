import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const videoEnvVars = [
  "VITE_AGENT_NATIVE_DEMO_VIDEO_URL",
  "VITE_AGENT_NATIVE_AGENT_SEES_DEMO_VIDEO_URL",
  "VITE_AGENT_NATIVE_UI_TALKS_DEMO_VIDEO_URL",
  "VITE_AGENT_NATIVE_CODE_UPDATES_DEMO_VIDEO_URL",
  "VITE_AGENT_NATIVE_BIDIRECTIONAL_DEMO_VIDEO_URL",
];

describe("homepage video fallbacks", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("renders finished fallback previews instead of loading skeletons when video URLs are unset", async () => {
    vi.resetModules();
    for (const envVar of videoEnvVars) {
      vi.stubEnv(envVar, "");
    }

    const { default: Home } = await import("../app/routes/_index");

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );

    expect(html).toContain("Visual plan");
    expect(html).toContain("Screen context");
    expect(html).not.toContain("animate-pulse");
    expect(html).not.toContain("<video");
  });
});
