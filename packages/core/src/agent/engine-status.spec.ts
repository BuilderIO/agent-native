import { afterEach, describe, expect, it, vi } from "vitest";

import { resetAppConfigForTests } from "../app-config/index.js";
import {
  resolveAgentEngineStatus,
  type AgentEngineStatusDeps,
} from "./engine-status.js";

const selection = vi.hoisted(() => ({
  replacement: undefined as string | undefined,
}));
vi.mock("./provider-model-selection.js", () => ({
  resolveUncheckedDefaultModelReplacement: async () => selection.replacement,
}));

type TestEntry = {
  name: string;
  defaultModel: string;
  supportedModels: readonly string[];
  requiredEnvVars: readonly string[];
};

const builderEntry: TestEntry = {
  name: "builder",
  defaultModel: "gpt-6-luna",
  supportedModels: ["gpt-6-luna", "claude-sonnet-5-5"],
  requiredEnvVars: ["BUILDER_GATEWAY_TOKEN", "BUILDER_GATEWAY_SPACE_ID"],
};

function deps(
  overrides: Partial<AgentEngineStatusDeps<TestEntry>> = {},
): AgentEngineStatusDeps<TestEntry> {
  return {
    readStoredEngine: async () => null,
    readOpenAiBaseUrlConfigured: () => false,
    isStoredEngineUsable: () => true,
    detectFromUserSecrets: async () => null,
    detectFromEnv: () => null,
    lookupEntry: () => builderEntry,
    ...overrides,
  };
}

afterEach(() => {
  selection.replacement = undefined;
  vi.unstubAllEnvs();
  resetAppConfigForTests();
});

describe("resolveAgentEngineStatus", () => {
  it("reports an engine detected from deploy env as configured", async () => {
    await expect(
      resolveAgentEngineStatus(deps({ detectFromEnv: () => builderEntry })),
    ).resolves.toMatchObject({
      configured: true,
      engine: "builder",
      source: "env",
      envVar: "BUILDER_GATEWAY_TOKEN",
    });
  });

  it("reports not configured, keeping the base-URL flag, when no source answers", async () => {
    await expect(
      resolveAgentEngineStatus(
        deps({ readOpenAiBaseUrlConfigured: () => true }),
      ),
    ).resolves.toEqual({ configured: false, openAiBaseUrlConfigured: true });
  });

  it("reports the configured model for a user's Builder connection", async () => {
    vi.stubEnv("AGENT_MODEL", "claude-sonnet-5-5");
    selection.replacement = "gpt-6-luna";

    await expect(
      resolveAgentEngineStatus(
        deps({ detectFromUserSecrets: async () => builderEntry }),
      ),
    ).resolves.toMatchObject({
      configured: true,
      engine: "builder",
      model: "claude-sonnet-5-5",
      source: "app_secrets",
    });
  });

  it("reports the checked-model fallback for an unpinned Builder run", async () => {
    vi.stubEnv("AGENT_MODEL", "auto");
    selection.replacement = "claude-sonnet-5-5";

    await expect(
      resolveAgentEngineStatus(
        deps({ detectFromUserSecrets: async () => builderEntry }),
      ),
    ).resolves.toMatchObject({
      configured: true,
      engine: "builder",
      model: "claude-sonnet-5-5",
    });
  });
});
