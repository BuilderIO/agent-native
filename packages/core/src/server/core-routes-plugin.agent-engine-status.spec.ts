import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import {
  resolveAgentEngineStatus,
  type AgentEngineStatusDeps,
  type AgentEngineStatusResult,
} from "./core-routes-plugin.js";

type TestEntry = {
  name: string;
  defaultModel: string;
  supportedModels: readonly string[];
  requiredEnvVars: readonly string[];
};

const openAiEntry: TestEntry = {
  name: "ai-sdk:openai",
  defaultModel: "gpt-5",
  supportedModels: ["gpt-5"],
  requiredEnvVars: ["OPENAI_API_KEY"],
};

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function createDeps(
  overrides: Partial<AgentEngineStatusDeps<TestEntry>> = {},
): AgentEngineStatusDeps<TestEntry> {
  return {
    readStoredEngine: async () => null,
    readOpenAiBaseUrlConfigured: () => false,
    isStoredEngineUsable: () => true,
    detectFromUserSecrets: async () => null,
    detectFromEnv: () => null,
    lookupEntry: () => openAiEntry,
    ...overrides,
  };
}

const originalAgentEngine = process.env.AGENT_ENGINE;

afterEach(() => {
  if (originalAgentEngine === undefined) delete process.env.AGENT_ENGINE;
  else process.env.AGENT_ENGINE = originalAgentEngine;
});

describe("agent-engine/status route failure handling", () => {
  // A 200 saying `configured: false` is an AUTHORITATIVE answer to the client:
  // it maps to `missing`, which gates the composer and shows "connect an AI
  // provider". So swallowing a lookup error into that shape tells a user with a
  // perfectly good key that they have none — the exact report this route caused.
  // 503 is the only response the client can distinguish, and it maps to the
  // retryable `unavailable` state that leaves the composer usable.
  it("answers a failed lookup with 503, never a 200 that claims nothing is configured", () => {
    const source = readFileSync(
      new URL("./core-routes-plugin.ts", import.meta.url),
      "utf8",
    );
    const handler = source.slice(source.indexOf("`${P}/agent-engine/status`"));
    const body = handler.slice(0, handler.indexOf("${P}/track"));

    expect(body).toContain("setResponseStatus(event, 503)");
    // A process-global in-flight lookup can outlive a credential write on a
    // different serverless function instance and return the pre-write answer.
    expect(body).not.toContain("shareAgentEngineStatusLookup");
    // The catch must not fabricate an authoritative negative answer.
    expect(body).not.toMatch(
      /catch\s*(\([^)]*\))?\s*\{[^}]*\}\s*return\s*\{\s*configured:\s*false/,
    );
  });
});

describe("resolveAgentEngineStatus", () => {
  it("starts the stored-setting and base-URL lookups concurrently", async () => {
    delete process.env.AGENT_ENGINE;
    const stored = deferred<{ engine?: string; model?: string } | null>();
    const baseUrl = deferred<boolean>();
    const started: string[] = [];

    const result = resolveAgentEngineStatus(
      createDeps({
        readStoredEngine: () => {
          started.push("stored");
          return stored.promise;
        },
        readOpenAiBaseUrlConfigured: () => {
          started.push("baseUrl");
          return baseUrl.promise;
        },
      }),
    );

    // Both are in flight before either has answered: sequencing them is what
    // made the probe slow enough for the composer to time out.
    expect(started).toEqual(["stored", "baseUrl"]);

    stored.resolve({ engine: "ai-sdk:openai" });
    baseUrl.resolve(true);
    await expect(result).resolves.toMatchObject({
      configured: true,
      engine: "ai-sdk:openai",
      openAiBaseUrlConfigured: true,
    });
  });

  it("skips the app_secrets sweep when the stored engine already answers", async () => {
    delete process.env.AGENT_ENGINE;
    let sweeps = 0;

    const result = await resolveAgentEngineStatus(
      createDeps({
        readStoredEngine: async () => ({ engine: "ai-sdk:openai" }),
        detectFromUserSecrets: async () => {
          sweeps += 1;
          return null;
        },
      }),
    );

    expect(result.configured).toBe(true);
    expect(sweeps).toBe(0);
  });

  it("still sweeps app_secrets when no cheaper source answers", async () => {
    delete process.env.AGENT_ENGINE;

    const result = await resolveAgentEngineStatus(
      createDeps({
        detectFromUserSecrets: async () => openAiEntry,
      }),
    );

    expect(result).toMatchObject({
      configured: true,
      engine: "ai-sdk:openai",
      source: "app_secrets",
      envVar: "OPENAI_API_KEY",
    });
  });

  it("reports the resolved base-URL flag even when nothing is configured", async () => {
    delete process.env.AGENT_ENGINE;

    await expect(
      resolveAgentEngineStatus(
        createDeps({ readOpenAiBaseUrlConfigured: () => true }),
      ),
    ).resolves.toEqual({ configured: false, openAiBaseUrlConfigured: true });
  });
});
