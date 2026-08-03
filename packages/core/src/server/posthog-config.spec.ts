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
    // A private key must never be inlined into the public HTML shell.
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

    // The worker bundles a string copy of this emitter and cannot import it, so
    // the two must be kept in sync by hand. This is the assertion that catches
    // a one-sided edit — the expected value is the worker's actual output.
    expect(getPostHogClientConfigScript()).toBe(
      '<script data-agent-native-posthog-config>window.__AGENT_NATIVE_CONFIG__=Object.assign({},window.__AGENT_NATIVE_CONFIG__,{"posthogKey":"phc_fake","posthogHost":"https://eu.i.posthog.com","posthogErrorTracking":true});</script>',
    );
  });
});
