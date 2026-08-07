import { describe, expect, it } from "vitest";

import {
  defineAgentNativeConfig,
  mergeAgentNativeConfigs,
  normalizeAgentNativeConfig,
  resolveAgentNativeConfig,
  type AgentNativeConfigContext,
} from "./config.js";

const devContext: AgentNativeConfigContext = {
  command: "serve",
  mode: "development",
  isDev: true,
  isBuild: false,
};

const buildContext: AgentNativeConfigContext = {
  command: "build",
  mode: "production",
  isDev: false,
  isBuild: true,
};

describe("agent-native app config", () => {
  it("keeps the authoring helper type-safe and identity-like", () => {
    const config = defineAgentNativeConfig({
      version: 1,
      onboarding: { firstRun: "connect" },
    });

    expect(config).toEqual({
      version: 1,
      onboarding: { firstRun: "connect" },
    });
  });

  it("resolves development and production defaults from one JSON-shaped config", () => {
    const config = {
      version: 1 as const,
      onboarding: {
        firstRun: {
          development: "connect" as const,
          production: "connect-and-integrations" as const,
        },
      },
    };

    expect(resolveAgentNativeConfig(config, devContext).onboarding).toEqual({
      firstRun: "connect",
    });
    expect(resolveAgentNativeConfig(config, buildContext).onboarding).toEqual({
      firstRun: "connect-and-integrations",
    });
  });

  it("supports a typed dynamic config factory", () => {
    const config = resolveAgentNativeConfig(
      ({ isDev }) => ({
        version: 1,
        onboarding: {
          firstRun: isDev ? "connect" : "connect-and-integrations",
        },
      }),
      buildContext,
    );

    expect(config.onboarding?.firstRun).toBe("connect-and-integrations");
  });

  it("rejects unsupported onboarding modes", () => {
    expect(() =>
      normalizeAgentNativeConfig({
        onboarding: { firstRun: "show-me-the-app" },
      }),
    ).toThrow('must be "off", "connect", or "connect-and-integrations"');
  });

  it("deep merges runtime and diagnostics config from JSON and typed overrides", () => {
    expect(
      mergeAgentNativeConfigs(
        {
          runtime: {
            auth: { enabled: true },
            environment: { required: ["NOTION_API_KEY"] },
          },
          diagnostics: { failOnBuild: false },
        },
        {
          runtime: {
            database: { required: false },
            environment: { required: ["GOOGLE_CLIENT_ID"] },
          },
          diagnostics: { failOnBuild: true },
        },
      ),
    ).toEqual({
      runtime: {
        auth: { enabled: true },
        database: { required: false },
        environment: { required: ["NOTION_API_KEY", "GOOGLE_CLIENT_ID"] },
      },
      diagnostics: { failOnBuild: true },
    });
  });

  it("validates non-secret runtime requirements", () => {
    expect(() =>
      normalizeAgentNativeConfig({
        runtime: { environment: { required: ["not valid"] } },
      }),
    ).toThrow("must contain valid environment variable names");
  });
});
