import { describe, expect, it } from "vitest";

import {
  defineAgentNativeConfig,
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
});
