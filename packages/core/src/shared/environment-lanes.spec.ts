import { describe, expect, it } from "vitest";

import { resolveLaneEndpoint } from "./environment-lanes.js";

describe("resolveLaneEndpoint", () => {
  it("sends a beta app's production-lane endpoint to the beta lane", () => {
    expect(
      resolveLaneEndpoint(
        "https://analytics.agent-native.com/api/analytics/track",
        "beta.clips.agent-native.com",
      ),
    ).toBe("https://beta.analytics.agent-native.com/api/analytics/track");
    expect(
      resolveLaneEndpoint(
        "https://analytics.agent-native.com/track",
        "BETA.Clips.agent-native.com.",
      ),
    ).toBe("https://beta.analytics.agent-native.com/track");
    expect(
      resolveLaneEndpoint(
        "https://analytics.agent-native.com/track",
        "beta.agent-workspace.builder.io",
      ),
    ).toBe("https://beta.analytics.agent-native.com/track");
  });

  it("leaves production, unknown, and missing app hosts on the configured endpoint", () => {
    const endpoint = "https://analytics.agent-native.com/track";
    expect(resolveLaneEndpoint(endpoint, "clips.agent-native.com")).toBe(
      endpoint,
    );
    expect(
      resolveLaneEndpoint(
        endpoint,
        "builder-agent-native-workspace.netlify.app",
      ),
    ).toBe(endpoint);
    expect(resolveLaneEndpoint(endpoint, "beta.example.com")).toBe(endpoint);
    expect(resolveLaneEndpoint(endpoint, undefined)).toBe(endpoint);
    expect(resolveLaneEndpoint(endpoint, "")).toBe(endpoint);
  });

  it("keeps endpoints a beta app was explicitly pointed at", () => {
    const appHost = "beta.clips.agent-native.com";
    for (const endpoint of [
      "https://analytics.example.test/track",
      "https://beta.analytics.agent-native.com/track",
      "/api/analytics/track",
    ]) {
      expect(resolveLaneEndpoint(endpoint, appHost)).toBe(endpoint);
    }
  });
});
