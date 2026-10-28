import { mockEvent } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetAppConfigForTests } from "../app-config/store.js";
import { crossSiteCookieAttrs } from "./auth.js";
import {
  isBuilderPreviewHttpsEnvironment,
  isHttpsRequest,
} from "./https-request.js";

const PREVIEW_ORIGIN = "https://abc123-development.builderio.xyz";

function event(headers: Record<string, string>) {
  return mockEvent("http://127.0.0.1:8100/_agent-native/auth/local-dev", {
    method: "POST",
    headers,
  });
}

const tunnelHeaders = {
  host: "127.0.0.1:8100",
  "x-forwarded-host": "localhost:8080",
  "x-forwarded-proto": "http",
};

describe("isHttpsRequest", () => {
  beforeEach(() => {
    for (const key of [
      "FUSION_ENV_ORIGIN",
      "VITE_FUSION_ENV_ORIGIN",
      "BUILDER_PREVIEW_URL",
      "VITE_BUILDER_PREVIEW_URL",
      "APP_URL",
      "VITE_APP_URL",
      "BETTER_AUTH_URL",
      "VITE_BETTER_AUTH_URL",
    ]) {
      vi.stubEnv(key, "");
    }
    vi.stubEnv("NODE_ENV", "development");
    resetAppConfigForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetAppConfigForTests();
  });

  it("trusts x-forwarded-proto https", () => {
    expect(isHttpsRequest(event({ "x-forwarded-proto": "https" }))).toBe(true);
  });

  it("stays plain HTTP for loopback dev without a preview origin", () => {
    expect(isHttpsRequest(event(tunnelHeaders))).toBe(false);
    expect(crossSiteCookieAttrs(event(tunnelHeaders))).toEqual({
      sameSite: "lax",
      secure: false,
    });
  });

  it("treats Builder preview tunnel requests as HTTPS so iframe cookies survive", () => {
    vi.stubEnv("FUSION_ENV_ORIGIN", PREVIEW_ORIGIN);
    expect(isBuilderPreviewHttpsEnvironment()).toBe(true);
    expect(isHttpsRequest(event(tunnelHeaders))).toBe(true);
    expect(crossSiteCookieAttrs(event(tunnelHeaders))).toEqual({
      sameSite: "none",
      secure: true,
      partitioned: true,
    });
  });

  it("ignores the preview origin in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FUSION_ENV_ORIGIN", PREVIEW_ORIGIN);
    expect(isBuilderPreviewHttpsEnvironment()).toBe(false);
    expect(isHttpsRequest(event(tunnelHeaders))).toBe(false);
  });

  it("ignores the preview origin for non-loopback hosts", () => {
    vi.stubEnv("FUSION_ENV_ORIGIN", PREVIEW_ORIGIN);
    expect(
      isHttpsRequest(
        event({ host: "example.com", "x-forwarded-proto": "http" }),
      ),
    ).toBe(false);
  });

  it("ignores non-Builder or plain-HTTP preview origins", () => {
    vi.stubEnv("FUSION_ENV_ORIGIN", "https://evil.example.com");
    expect(isHttpsRequest(event(tunnelHeaders))).toBe(false);
    vi.stubEnv("FUSION_ENV_ORIGIN", "http://abc123-development.builderio.xyz");
    expect(isHttpsRequest(event(tunnelHeaders))).toBe(false);
  });
});
