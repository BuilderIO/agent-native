import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getAuthDisabledExposure,
  reportAuthDisabledExposure,
} from "./auth-disabled-exposure.js";

describe("AUTH_DISABLED exposure", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_DISABLED", "true");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", "");
    vi.stubEnv("CONTEXT", "");
    vi.stubEnv("NETLIFY_CONTEXT", "");
    vi.stubEnv("AGENT_NATIVE_BUILD_DEPLOY_CONTEXT", "");
    vi.stubEnv("BRANCH", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("FUSION_ENVIRONMENT", "");
    vi.stubEnv("FUSION_POD_UID", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stays quiet on a local development server", () => {
    const log = vi.fn();
    reportAuthDisabledExposure(log);
    expect(getAuthDisabledExposure()).toBeNull();
    expect(log).not.toHaveBeenCalled();
  });

  it("stays quiet when AUTH_DISABLED is off, wherever the server runs", () => {
    vi.stubEnv("AUTH_DISABLED", "false");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FUSION_POD_UID", "pod-1");
    const log = vi.fn();
    reportAuthDisabledExposure(log);
    expect(log).not.toHaveBeenCalled();
  });

  it.each([
    ["NODE_ENV", "production"],
    ["AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", "production"],
    ["CONTEXT", "production"],
  ])("reports a production server (%s=%s)", (key, value) => {
    vi.stubEnv(key, value);
    const log = vi.fn();
    reportAuthDisabledExposure(log);
    expect(getAuthDisabledExposure()).toBe("production");
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("AUTH_DISABLED is set on a production server"),
    );
  });

  it.each([
    ["FUSION_ENVIRONMENT", "cloud-v2"],
    ["FUSION_POD_UID", "pod-1"],
  ])("reports a dev server on a public preview URL (%s)", (key, value) => {
    vi.stubEnv(key, value);
    const log = vi.fn();
    reportAuthDisabledExposure(log);
    expect(getAuthDisabledExposure()).toBe("public-dev-container");
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("local development on loopback only"),
    );
  });
});
