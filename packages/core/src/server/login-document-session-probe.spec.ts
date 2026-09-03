import { describe, expect, it } from "vitest";

import { shouldRetryAuthSessionProbe } from "../client/auth/AuthPage.js";
import { getOnboardingHtml } from "./onboarding-html.js";

describe("login document session probe", () => {
  it("retries unreadable and transient session responses", () => {
    expect(shouldRetryAuthSessionProbe({ status: 200 }, false)).toBe(true);
    expect(shouldRetryAuthSessionProbe({ status: 429 }, true)).toBe(true);
    expect(shouldRetryAuthSessionProbe({ status: 503 }, true)).toBe(true);
  });

  it("stops on a readable signed-out or client-error response", () => {
    expect(shouldRetryAuthSessionProbe({ status: 200 }, true)).toBe(false);
    expect(shouldRetryAuthSessionProbe({ status: 401 }, true)).toBe(false);
  });

  it("ships a hydratable React auth root", () => {
    const html = getOnboardingHtml();
    expect(html).toContain('id="agent-native-auth-root"');
    expect(html).toContain('src="/assets/auth-client.js"');
  });

  it("cache-busts the auth client for a deployed build", () => {
    const previousBuildId = process.env.AGENT_NATIVE_BUILD_ID;
    process.env.AGENT_NATIVE_BUILD_ID = "deploy-123";
    try {
      expect(getOnboardingHtml()).toContain(
        'src="/assets/auth-client.js?__an_build=deploy-123"',
      );
    } finally {
      if (previousBuildId === undefined) {
        delete process.env.AGENT_NATIVE_BUILD_ID;
      } else {
        process.env.AGENT_NATIVE_BUILD_ID = previousBuildId;
      }
    }
  });
});
