import { describe, expect, it } from "vitest";

import {
  agentNativeConfigEnvName,
  defineAgentNativeConfig,
  inferAgentNativeDeploymentEnvironment,
  mergeAgentNativeConfigs,
  normalizeAgentNativeConfig,
  readAgentNativeConfigEnv,
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

  it("keeps translations and changelog generation opt-in", () => {
    expect(normalizeAgentNativeConfig({})).toEqual({});
    expect(
      normalizeAgentNativeConfig({
        translations: { locales: ["en-US", " es-ES", "en-US"] },
        changelog: { enabled: false },
      }),
    ).toEqual({
      translations: { locales: ["en-US", "es-ES"] },
      changelog: { enabled: false },
    });
  });

  it("normalizes and merges the public deployment environment", () => {
    expect(
      normalizeAgentNativeConfig({ deployment: { environment: "beta" } }),
    ).toEqual({ deployment: { environment: "beta" } });
    expect(
      mergeAgentNativeConfigs(
        { deployment: { environment: "production" } },
        { deployment: { environment: "beta" } },
      ),
    ).toEqual({ deployment: { environment: "beta" } });
  });

  it.each([
    [
      {
        AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT: "beta",
        BRANCH: "beta",
        CONTEXT: "production",
      },
      "beta",
    ],
    [{ BRANCH: "beta", CONTEXT: "branch-deploy" }, "beta"],
    [{ BRANCH: "main", CONTEXT: "branch-deploy" }, "beta"],
    [{ BRANCH: "beta", CONTEXT: "production" }, "beta"],
    [{ BRANCH: "production", CONTEXT: "production" }, "production"],
    [{ BRANCH: "feature/auth", CONTEXT: "deploy-preview" }, "preview"],
    [{ BRANCH: "feature/auth", VERCEL_ENV: "preview" }, "preview"],
    [{}, "local"],
  ] as const)(
    "infers deployment environment from hosting facts",
    (env, expected) => {
      expect(inferAgentNativeDeploymentEnvironment(env, "development")).toBe(
        expected,
      );
    },
  );

  it("rejects unsupported explicit deployment environments", () => {
    expect(() =>
      inferAgentNativeDeploymentEnvironment(
        { AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT: "staging" },
        "development",
      ),
    ).toThrow(
      'AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT must be "local", "beta", "production", or "preview"',
    );
  });

  it("normalizes hosted harness capabilities and runtimes", () => {
    expect(normalizeAgentNativeConfig({ harness: true })).toEqual({
      harness: true,
    });
    expect(
      normalizeAgentNativeConfig({
        harness: {
          runtimes: ["claude-code", "codex", "claude-code"],
        },
      }),
    ).toEqual({
      harness: {
        runtimes: ["claude-code", "codex"],
      },
    });
    expect(
      mergeAgentNativeConfigs(
        { harness: { runtimes: ["claude-code"] } },
        { harness: { runtimes: ["codex"] } },
      ),
    ).toEqual({
      harness: {
        runtimes: ["claude-code", "codex"],
      },
    });
  });

  it("lets an app replace the inherited locale allowlist", () => {
    expect(
      mergeAgentNativeConfigs(
        { translations: { locales: ["en-US"] } },
        { translations: { locales: ["en-US", "fr-FR"] } },
      ),
    ).toEqual({
      translations: { locales: ["en-US", "fr-FR"] },
    });
  });

  it.each([
    { translations: { locales: ["en-US", ""] } },
    { translations: { locales: ["en-US", 42] } },
    { changelog: { enabled: "yes" } },
    { deployment: { environment: "staging" } },
    { harness: { runtimes: ["shell"] } },
    { harness: { enabled: true } },
    { harness: { ui: "desktop" } },
  ])("rejects invalid lightweight policy config: %o", (config) => {
    expect(() => normalizeAgentNativeConfig(config)).toThrow();
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

  it("normalizes audience-specific instruction paths", () => {
    expect(
      normalizeAgentNativeConfig({
        instructions: {
          runtime: "app-agent/AGENTS.md",
          development: "DEVELOPING.md",
        },
      }),
    ).toEqual({
      instructions: {
        runtime: "app-agent/AGENTS.md",
        development: "DEVELOPING.md",
      },
    });
  });

  it("deep-merges instruction paths", () => {
    expect(
      mergeAgentNativeConfigs(
        { instructions: { runtime: "AGENTS.md" } },
        { instructions: { development: "DEVELOPING.md" } },
      ),
    ).toEqual({
      instructions: {
        runtime: "AGENTS.md",
        development: "DEVELOPING.md",
      },
    });
  });

  it.each(["/tmp/AGENTS.md", "../AGENTS.md", "", "C:\\AGENTS.md"])(
    "rejects unsafe instruction path %s",
    (instructionPath) => {
      expect(() =>
        normalizeAgentNativeConfig({
          instructions: { runtime: instructionPath },
        }),
      ).toThrow("must be a non-empty relative file path inside the app root");
    },
  );
});

describe("agent-native config environment aliases", () => {
  it("maps config paths to deterministic environment names", () => {
    expect(agentNativeConfigEnvName([])).toBe("AGENT_NATIVE_CONFIG");
    expect(agentNativeConfigEnvName(["runtime"])).toBe(
      "AGENT_NATIVE_CONFIG_RUNTIME",
    );
    expect(agentNativeConfigEnvName(["runtime", "auth", "enabled"])).toBe(
      "AGENT_NATIVE_CONFIG_RUNTIME_AUTH_ENABLED",
    );
    expect(agentNativeConfigEnvName(["instructions", "firstRun"])).toBe(
      "AGENT_NATIVE_CONFIG_INSTRUCTIONS_FIRST_RUN",
    );
  });

  it("accepts complete, section, and leaf JSON fragments", () => {
    expect(
      readAgentNativeConfigEnv({
        AGENT_NATIVE_CONFIG: JSON.stringify({
          version: 1,
          runtime: {
            auth: { enabled: false },
            database: { required: true },
          },
          onboarding: {
            firstRun: {
              development: "connect",
              default: "off",
            },
          },
        }),
        AGENT_NATIVE_CONFIG_RUNTIME: JSON.stringify({
          auth: { enabled: true },
          environment: { required: ["PUBLIC_API_ORIGIN"] },
        }),
        AGENT_NATIVE_CONFIG_RUNTIME_AUTH: JSON.stringify({ enabled: false }),
        AGENT_NATIVE_CONFIG_RUNTIME_AUTH_ENABLED: "true",
        AGENT_NATIVE_CONFIG_TRANSLATIONS_LOCALES: JSON.stringify([
          "en-US",
          "es-ES",
        ]),
        AGENT_NATIVE_CONFIG_INSTRUCTIONS_RUNTIME: JSON.stringify(
          "app-agent/AGENTS.md",
        ),
      }),
    ).toEqual({
      version: 1,
      onboarding: {
        firstRun: { development: "connect", default: "off" },
      },
      runtime: {
        auth: { enabled: true },
        database: { required: true },
        environment: { required: ["PUBLIC_API_ORIGIN"] },
      },
      instructions: { runtime: "app-agent/AGENTS.md" },
      translations: { locales: ["en-US", "es-ES"] },
    });
  });

  it("lets the canonical deployment path replace the legacy alias", () => {
    expect(
      readAgentNativeConfigEnv({
        AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT: "local",
        AGENT_NATIVE_CONFIG_DEPLOYMENT_ENVIRONMENT: " BETA ",
      }),
    ).toEqual({ deployment: { environment: "beta" } });
  });

  it.each([
    {
      AGENT_NATIVE_CONFIG: "true",
    },
    {
      AGENT_NATIVE_CONFIG_RUNTIME: '{"auth":',
    },
    {
      AGENT_NATIVE_CONFIG_RUNTIME_AUTH_ENABLED: "maybe",
    },
    {
      AGENT_NATIVE_CONFIG_RUNTIME_AUTH_UNKNOWN: "true",
    },
  ])("rejects invalid or unsupported aliases: %o", (env) => {
    expect(() => readAgentNativeConfigEnv(env)).toThrow();
  });
});
