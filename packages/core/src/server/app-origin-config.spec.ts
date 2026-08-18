import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetAppConfigForTests } from "../app-config/index.js";
import {
  getAppOriginClientConfigScript,
  resolvePublicAppOriginConfig,
} from "./app-origin-config.js";

const originalEnv = { ...process.env };
const KEYS = [
  "APP_URL",
  "VITE_APP_URL",
  "BETTER_AUTH_URL",
  "VITE_BETTER_AUTH_URL",
  "WORKSPACE_GATEWAY_URL",
  "VITE_WORKSPACE_GATEWAY_URL",
  "WORKSPACE_OAUTH_ORIGIN",
  "VITE_WORKSPACE_OAUTH_ORIGIN",
];

describe("app origin client config", () => {
  beforeEach(() => {
    resetAppConfigForTests();
    process.env = { ...originalEnv };
    for (const key of KEYS) delete process.env[key];
  });

  afterEach(() => {
    resetAppConfigForTests();
    process.env = { ...originalEnv };
  });

  it("projects nothing when no origin is configured", () => {
    expect(resolvePublicAppOriginConfig()).toBeNull();
    expect(getAppOriginClientConfigScript()).toBeNull();
  });

  it("projects the declared origins into the shell", () => {
    process.env.APP_URL = "https://app.example.com";
    process.env.WORKSPACE_GATEWAY_URL = "https://gateway.example.com";
    process.env.WORKSPACE_OAUTH_ORIGIN = "https://oauth.example.com";

    expect(resolvePublicAppOriginConfig()).toEqual({
      appUrl: "https://app.example.com",
      workspaceGatewayUrl: "https://gateway.example.com",
      workspaceOAuthOrigin: "https://oauth.example.com",
    });
  });

  it("carries the VITE spelling through the same field", () => {
    // The whole point of 8b: the prefix is a delivery detail, so a deployment
    // that only set the mirror still resolves one declared value.
    process.env.VITE_APP_URL = "https://vite.example.com";
    process.env.VITE_WORKSPACE_GATEWAY_URL = "https://vite-gw.example.com";

    expect(resolvePublicAppOriginConfig()).toEqual({
      appUrl: "https://vite.example.com",
      workspaceGatewayUrl: "https://vite-gw.example.com",
    });
  });

  it("prefers the canonical spelling over its mirror", () => {
    process.env.APP_URL = "https://canonical.example.com";
    process.env.VITE_APP_URL = "https://mirror.example.com";

    expect(resolvePublicAppOriginConfig()?.appUrl).toBe(
      "https://canonical.example.com",
    );
  });

  it("emits a shell script that merges rather than replaces", () => {
    process.env.APP_URL = "https://app.example.com";
    const script = getAppOriginClientConfigScript();

    expect(script).toContain("data-agent-native-app-origin-config");
    expect(script).toContain(
      "window.__AGENT_NATIVE_CONFIG__=Object.assign({},window.__AGENT_NATIVE_CONFIG__,",
    );
    expect(script).toContain('"appUrl":"https://app.example.com"');
  });

  it("omits absent fields instead of emitting undefined", () => {
    process.env.APP_URL = "https://app.example.com";
    const config = resolvePublicAppOriginConfig();

    expect(config).not.toHaveProperty("workspaceGatewayUrl");
    expect(JSON.stringify(config)).not.toContain("undefined");
  });
});
