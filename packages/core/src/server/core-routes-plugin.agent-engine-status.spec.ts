import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { getOrgContext } from "../org/context.js";
import { getSession } from "./auth.js";
import {
  resolveAgentEngineStatusIdentity,
  resolveAgentEngineStatus,
  type AgentEngineStatusDeps,
  type AgentEngineStatusResult,
} from "./core-routes-plugin.js";

vi.mock("../org/context.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../org/context.js")>()),
  getOrgContext: vi.fn(),
}));

vi.mock("./auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./auth.js")>()),
  getSession: vi.fn(),
}));
import { runWithRequestContext } from "./request-context.js";

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

const builderEntry: TestEntry = {
  name: "builder",
  defaultModel: "gpt-5",
  supportedModels: ["gpt-5"],
  requiredEnvVars: ["BUILDER_GATEWAY_TOKEN", "BUILDER_GATEWAY_SPACE_ID"],
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
  vi.mocked(getOrgContext).mockReset();
  vi.mocked(getSession).mockReset();
});

describe("resolveAgentEngineStatusIdentity", () => {
  it("propagates session lookup failures", async () => {
    vi.mocked(getSession).mockRejectedValue(new Error("session read failed"));

    await expect(resolveAgentEngineStatusIdentity({} as never)).rejects.toThrow(
      "session read failed",
    );
  });

  it("propagates organization lookup failures", async () => {
    vi.mocked(getSession).mockResolvedValue({
      email: "alice@example.com",
    } as Awaited<ReturnType<typeof getSession>>);
    vi.mocked(getOrgContext).mockRejectedValue(
      new Error("organization read failed"),
    );

    await expect(resolveAgentEngineStatusIdentity({} as never)).rejects.toThrow(
      "organization read failed",
    );
  });

  it("tolerates only an unavailable organization schema", async () => {
    vi.mocked(getSession).mockResolvedValue({
      email: "alice@example.com",
    } as Awaited<ReturnType<typeof getSession>>);
    vi.mocked(getOrgContext).mockRejectedValue(
      new Error('no such table: "organizations"'),
    );

    await expect(
      resolveAgentEngineStatusIdentity({} as never),
    ).resolves.toEqual({ userEmail: "alice@example.com", orgId: undefined });
  });
});

describe("agent-engine/status route failure handling", () => {
  it("answers a failed lookup with 503, never a 200 that claims nothing is configured", () => {
    const source = readFileSync(
      new URL("./core-routes-plugin.ts", import.meta.url),
      "utf8",
    );
    const handler = source.slice(source.indexOf("`${P}/agent-engine/status`"));
    const body = handler.slice(0, handler.indexOf("${P}/track"));

    expect(body).toContain("setResponseStatus(event, 503)");
    expect(body).not.toContain("shareAgentEngineStatusLookup");
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

  it("lets synthetic checks fall through an unusable deploy engine to user secrets", async () => {
    process.env.AGENT_ENGINE = "builder";

    const result = await runWithRequestContext(
      { isSyntheticTraffic: true },
      () =>
        resolveAgentEngineStatus(
          createDeps({
            lookupEntry: (name) =>
              name === "builder" ? builderEntry : openAiEntry,
            isStoredEngineUsable: (stored) =>
              (stored as { engine?: string }).engine !== "builder",
            detectFromUserSecrets: async () => openAiEntry,
          }),
        ),
    );

    expect(result).toMatchObject({
      configured: true,
      engine: "ai-sdk:openai",
      source: "app_secrets",
    });
  });
});
