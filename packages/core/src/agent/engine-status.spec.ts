import { afterEach, describe, expect, it } from "vitest";

import { resetAppConfigForTests } from "../app-config/index.js";
import {
  resolveAgentEngineStatus,
  type AgentEngineStatusDeps,
} from "./engine-status.js";

type TestEntry = {
  name: string;
  defaultModel: string;
  supportedModels: readonly string[];
  requiredEnvVars: readonly string[];
};

const builderEntry: TestEntry = {
  name: "builder",
  defaultModel: "gpt-5",
  supportedModels: ["gpt-5"],
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
});
