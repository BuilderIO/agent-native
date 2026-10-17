import { afterEach, describe, expect, it, vi } from "vitest";

import { trackingIdentityProperties } from "./tracking-identity.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("trackingIdentityProperties", () => {
  it("derives the app from the configured base path on a multi-app workspace host", () => {
    vi.stubEnv("APP_URL", "https://beta.agent-workspace.builder.io");
    vi.stubEnv("APP_BASE_PATH", "/dispatch");

    expect(trackingIdentityProperties()).toMatchObject({
      app: "dispatch",
      template: "dispatch",
    });
  });

  it("falls back to the hostname guess when no base path is configured", () => {
    vi.stubEnv("APP_URL", "https://beta.agent-workspace.builder.io");

    expect(trackingIdentityProperties()).toMatchObject({
      app: "agent-workspace",
      template: "agent-workspace",
    });
  });

  it("still resolves a single-app *.agent-native.com host without a base path", () => {
    vi.stubEnv("APP_URL", "https://beta.slides.agent-native.com");

    expect(trackingIdentityProperties()).toMatchObject({
      app: "slides",
      template: "slides",
    });
  });

  it("prefers AGENT_NATIVE_APP over the configured base path", () => {
    vi.stubEnv("APP_URL", "https://beta.agent-workspace.builder.io");
    vi.stubEnv("APP_BASE_PATH", "/dispatch");
    vi.stubEnv("AGENT_NATIVE_APP", "coach");

    expect(trackingIdentityProperties()).toMatchObject({ app: "coach" });
  });
});
