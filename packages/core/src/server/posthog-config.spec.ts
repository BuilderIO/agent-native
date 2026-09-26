import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getPostHogClientConfigScript,
  resolvePublicPostHogConfig,
} from "./posthog-config.js";

describe("resolvePublicPostHogConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is absent when no public key is configured", () => {
    vi.stubEnv("POSTHOG_PUBLIC_KEY", "");
    vi.stubEnv("VITE_POSTHOG_KEY", "");
    vi.stubEnv("VITE_POSTHOG_PUBLIC_KEY", "");

    expect(resolvePublicPostHogConfig()).toBeUndefined();
    expect(getPostHogClientConfigScript()).toBeNull();
  });

  it("never falls back to the server POSTHOG_API_KEY", () => {
    vi.stubEnv("POSTHOG_PUBLIC_KEY", "");
    vi.stubEnv("VITE_POSTHOG_KEY", "");
    vi.stubEnv("VITE_POSTHOG_PUBLIC_KEY", "");
    vi.stubEnv("POSTHOG_API_KEY", "phx_private_placeholder");

    expect(resolvePublicPostHogConfig()).toBeUndefined();
  });

  it("resolves the key and normalizes a trailing slash on the host", () => {
    vi.stubEnv("POSTHOG_PUBLIC_KEY", "phc_public_placeholder");
    vi.stubEnv("POSTHOG_PUBLIC_HOST", "https://eu.i.posthog.com/");

    expect(resolvePublicPostHogConfig()).toEqual({
      posthogKey: "phc_public_placeholder",
      posthogHost: "https://eu.i.posthog.com",
      posthogErrorTracking: true,
    });
  });

  it("honours the error-tracking opt-out", () => {
    vi.stubEnv("POSTHOG_PUBLIC_KEY", "phc_public_placeholder");
    vi.stubEnv("POSTHOG_ERROR_TRACKING", "false");

    expect(resolvePublicPostHogConfig()?.posthogErrorTracking).toBe(false);
  });

  it("emits a shell script byte-identical to the worker copy in deploy/build.ts", () => {
    vi.stubEnv("POSTHOG_PUBLIC_KEY", "phc_fake");
    vi.stubEnv("POSTHOG_PUBLIC_HOST", "");
    vi.stubEnv("VITE_POSTHOG_HOST", "");
    vi.stubEnv("POSTHOG_HOST", "https://eu.i.posthog.com/");
    vi.stubEnv("POSTHOG_ERROR_TRACKING", "");

    expect(getPostHogClientConfigScript()).toBe(
      '<script data-agent-native-posthog-config>window.__AGENT_NATIVE_CONFIG__=Object.assign({},window.__AGENT_NATIVE_CONFIG__,{"posthogKey":"phc_fake","posthogHost":"https://eu.i.posthog.com","posthogErrorTracking":true});</script>',
    );
  });
});
